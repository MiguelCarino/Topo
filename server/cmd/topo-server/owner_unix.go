//go:build unix

package main

import (
	"os"
	"syscall"
)

// rootOnForeignData reports that this process runs as root on a data folder
// that belongs to another user (the service's): files root makes there
// would be root's, and the service could not write or read them.
func rootOnForeignData(dir string) bool {
	if os.Geteuid() != 0 {
		return false
	}
	fi, err := os.Stat(dir)
	if err != nil {
		return false
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	return ok && st.Uid != 0
}
