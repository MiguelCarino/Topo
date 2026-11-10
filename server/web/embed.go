// Package web holds the app the server serves: dist/ is filled by
// `make stage` (desktop/stage.sh, the same allow-list as the offline zip)
// and embedded at build time. A build without a stage still compiles; it
// answers / with 503 and the API works.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// App is the staged app with dist/ as its root.
func App() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // dist is embedded, so it always exists
	}
	return sub
}
