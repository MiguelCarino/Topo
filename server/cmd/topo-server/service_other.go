//go:build !windows && !linux && !darwin

package main

import "io"

// No service manager is wired up on this OS: run `topo-server serve` under
// its own (rc.d, a container) as docs/SERVER.md describes.

func confPath() string { return "" }

func svcInstall(io.Writer, svcOptions) error   { return errUnsupported }
func svcUninstall(io.Writer) error             { return errUnsupported }
func svcStart(io.Writer) error                 { return errUnsupported }
func svcStop(io.Writer) error                  { return errUnsupported }
func svcConfigure(io.Writer, svcOptions) error { return errUnsupported }
func svcStatus() serviceStatus                 { return serviceStatus{} }
func svcLog(int) []string                      { return nil }
