// Package packaging carries the service files inside the binary, for a later
// `topo-server install-service` (the installers step after 5a).
package packaging

import "embed"

//go:embed topo-server.service topo-server.user.service container/topo.container
var Files embed.FS
