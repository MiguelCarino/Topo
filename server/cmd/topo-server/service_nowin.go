//go:build !windows

package main

import (
	"context"
	"io"
)

// runningAsService is true only for a Windows service: systemd and launchd
// run `serve` as a plain process that stops on SIGTERM.
func runningAsService() bool { return false }

// runService is never reached outside Windows.
func runService(func(ctx context.Context, logw io.Writer) error, io.Writer) int { return 1 }
