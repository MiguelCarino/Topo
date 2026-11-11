package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// OneDrive writes into the app's own folder (Apps/<app name>) through
// Microsoft Graph, with Files.ReadWrite.AppFolder (D110). A file of up to
// 4 MB goes up in one PUT; a larger one through an upload session in
// pieces of 3.75 MB (a multiple of 320 KiB, as Graph asks). The upload
// session address and the download address Graph redirects to are on
// other hosts and are pre-authorised: the token is never sent there
// (amendment 12).
type OneDrive struct {
	o  *oauthClient
	ep Endpoints
}

const (
	// OneDriveSimpleMax is the largest body sent in one PUT.
	OneDriveSimpleMax = 4 << 20
	// OneDriveChunk is the size of each upload-session piece.
	OneDriveChunk = 12 * 320 << 10
)

// NewOneDrive opens a OneDrive destination.
func NewOneDrive(s Settings, h Hooks) (*OneDrive, error) {
	o, err := newOAuthClient("onedrive", s, h)
	if err != nil {
		return nil, err
	}
	return &OneDrive{o: o, ep: endpointsOf("onedrive", s.Fields["tenant"])}, nil
}

func (d *OneDrive) Kind() string { return "onedrive" }

// Ref is oauth_ref (the account; the app folder needs no id).
func (d *OneDrive) Ref() string { return d.o.hooks.Ref }

const approot = "/me/drive/special/approot"

// itemURL is approot:/<path>:<suffix>, each segment escaped.
func (d *OneDrive) itemURL(rel, suffix string) string {
	segs := strings.Split(rel, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return d.ep.API + approot + ":/" + strings.Join(segs, "/") + ":" + suffix
}

type graphItem struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	Size                 int64     `json:"size"`
	LastModifiedDateTime string    `json:"lastModifiedDateTime"`
	File                 *struct{} `json:"file"`
	CreatedBy            struct {
		User struct {
			DisplayName string `json:"displayName"`
			Email       string `json:"email"`
		} `json:"user"`
	} `json:"createdBy"`
}

func (d *OneDrive) Put(ctx context.Context, name string, body []byte) (string, error) {
	if len(body) > MaxFile {
		return "", errf(CodeTooLarge, "%d bytes", len(body))
	}
	if !validRel(name) {
		return "", errf(CodeOther, "bad name")
	}
	var it graphItem
	var err error
	if len(body) <= OneDriveSimpleMax {
		err = d.o.json(ctx, apiReq{method: "PUT", url: d.itemURL(name, "/content") + "?@microsoft.graph.conflictBehavior=replace", body: body,
			hdr: map[string]string{"Content-Type": "application/json"}}, &it)
	} else {
		err = d.session(ctx, name, body, &it)
	}
	if err != nil {
		return "", err
	}
	if it.ID == "" {
		return "", errf(CodeBadAnswer, "no item id")
	}
	if it.Size != int64(len(body)) {
		return "", errf(CodeBadAnswer, "the file is not the size written")
	}
	return it.ID, nil
}

// session uploads body through an upload session.
func (d *OneDrive) session(ctx context.Context, name string, body []byte, it *graphItem) error {
	req, _ := json.Marshal(map[string]any{"item": map[string]any{"@microsoft.graph.conflictBehavior": "replace"}})
	var s struct {
		UploadURL string `json:"uploadUrl"`
	}
	if err := d.o.json(ctx, apiReq{method: "POST", url: d.itemURL(name, "/createUploadSession"), body: req, hdr: map[string]string{"Content-Type": "application/json"}}, &s); err != nil {
		return err
	}
	if !plainURL(s.UploadURL) {
		return errf(CodeBadAnswer, "upload session address")
	}
	total := len(body)
	for off := 0; off < total; off += OneDriveChunk {
		end := min(off+OneDriveChunk, total)
		resp, err := d.o.do(ctx, apiReq{method: "PUT", url: s.UploadURL, body: body[off:end], noAuth: true,
			hdr: map[string]string{"Content-Range": fmt.Sprintf("bytes %d-%d/%d", off, end-1, total)}})
		if err != nil {
			return err
		}
		switch {
		case resp.StatusCode == 202 && end < total:
			drain(resp)
		case (resp.StatusCode == 200 || resp.StatusCode == 201) && end == total:
			err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(it)
			drain(resp)
			if err != nil {
				return errf(CodeBadAnswer, "upload: %v", err)
			}
			return nil
		default:
			drain(resp)
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return errf(CodeBadAnswer, "upload: HTTP %d at %d of %d", resp.StatusCode, end, total)
			}
			return statusErr(resp.StatusCode)
		}
	}
	return errf(CodeBadAnswer, "upload: empty")
}

func (d *OneDrive) contentURL(name, ref string) string {
	if ref != "" {
		return d.ep.API + "/me/drive/items/" + url.PathEscape(ref) + "/content"
	}
	return d.itemURL(name, "/content")
}

// Get follows Graph's 302 to the download address, without the token (the
// only redirect any destination follows, amendment 12).
func (d *OneDrive) Get(ctx context.Context, name, ref string) (io.ReadCloser, error) {
	if !validRel(name) {
		return nil, errf(CodeOther, "bad name")
	}
	resp, err := d.o.do(ctx, apiReq{method: "GET", url: d.contentURL(name, ref)})
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusSeeOther || resp.StatusCode == http.StatusTemporaryRedirect {
		loc := resp.Header.Get("Location")
		drain(resp)
		if !plainURL(loc) {
			return nil, errf(CodeBadAnswer, "download address")
		}
		if resp, err = d.o.do(ctx, apiReq{method: "GET", url: loc, noAuth: true}); err != nil {
			return nil, err
		}
	}
	if resp.StatusCode != 200 {
		drain(resp)
		return nil, statusErr(resp.StatusCode)
	}
	return resp.Body, nil
}

func (d *OneDrive) Delete(ctx context.Context, name, ref string) error {
	if !validRel(name) {
		return errf(CodeOther, "bad name")
	}
	u := d.itemURL(name, "")
	u = strings.TrimSuffix(u, ":")
	if ref != "" {
		u = d.ep.API + "/me/drive/items/" + url.PathEscape(ref)
	}
	resp, err := d.o.do(ctx, apiReq{method: "DELETE", url: u})
	if err != nil {
		return err
	}
	drain(resp)
	if resp.StatusCode == 204 || resp.StatusCode == 200 {
		return nil
	}
	return statusErr(resp.StatusCode)
}

func (d *OneDrive) List(ctx context.Context, dir string) ([]Entry, error) {
	if dir != "" && !validRel(dir) {
		return nil, errf(CodeOther, "bad name")
	}
	next := d.ep.API + approot + "/children"
	if dir != "" {
		next = d.itemURL(dir, "/children")
	}
	next += "?$select=id,name,size,lastModifiedDateTime,file&$top=200"
	var out []Entry
	for page := 0; page < 1000 && next != ""; page++ {
		var ans struct {
			Value    []graphItem `json:"value"`
			NextLink string      `json:"@odata.nextLink"`
		}
		err := d.o.json(ctx, apiReq{method: "GET", url: next}, &ans)
		if CodeOf(err) == CodeNotFound && page == 0 {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		for _, it := range ans.Value {
			if it.File == nil {
				continue // a folder
			}
			e := Entry{Name: it.Name, Size: it.Size, Ref: it.ID}
			if t, err := time.Parse(time.RFC3339, it.LastModifiedDateTime); err == nil {
				e.Mod = t
			}
			out = append(out, e)
		}
		next = ans.NextLink
		if next != "" && !sameOrigin(next, d.ep.API) {
			return nil, errf(CodeBadAnswer, "next page elsewhere")
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (d *OneDrive) Check(ctx context.Context) error {
	// Reading the app folder makes it on first use.
	if err := d.o.json(ctx, apiReq{method: "GET", url: d.ep.API + approot}, nil); err != nil {
		return err
	}
	return probe(ctx, d)
}

// Account is who made the app folder, when Graph says it ("" if not;
// not checked against a real account here).
func (d *OneDrive) Account(ctx context.Context) string {
	var it graphItem
	if err := d.o.json(ctx, apiReq{method: "GET", url: d.ep.API + approot + "?$select=id,createdBy"}, &it); err != nil {
		return ""
	}
	if it.CreatedBy.User.Email != "" {
		return it.CreatedBy.User.Email
	}
	return it.CreatedBy.User.DisplayName
}
