# topo-server

The Topo server: one static Go binary that serves the Topo app and its API
(email sign-in, sites shared with roles, end-to-end encrypted sync through
the existing merge). The client hosts it. How to run it, configure it, put
https in front and back it up is in [docs/SERVER.md](../docs/SERVER.md).

```
make build        # stage the app (desktop/stage.sh) and build dist/topo-server
make test         # go test ./... (plus -race when a C compiler is present)
make vet          # go vet for linux, darwin and windows
make cross        # linux, darwin, windows x amd64, arm64, one at a time
make container    # podman image localhost/topo-server (context: the repo root)
make dev          # a staged copy in a temp folder, mail to files, 127.0.0.1:7381
make e2e          # build, then tests/server-e2e.mjs on E2E_PORT (default 7381)
```

Layout: `cmd/topo-server` (serve, healthcheck, version, setup-token, mail-test),
`internal/config` (TOPO_* settings), `internal/store` (SQLite and its
migrations), `internal/api` (routes, middleware, static app),
`internal/auth`, `internal/mail`, `internal/notify`, `internal/hub` (live
events), `internal/tcrypto` (checks of the browser's signatures),
`internal/platform`, `web` (the embedded app, filled by
`make stage`), `packaging` (systemd units, Quadlet).

Without `make stage` the binary still builds; it then answers `/` with 503
and the API works. `go test ./...` needs no stage.
