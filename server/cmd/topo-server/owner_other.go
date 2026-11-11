//go:build !unix

package main

// rootOnForeignData: no such check off Unix (a Windows service's folder is
// shared by Local Service and Administrators through its access list).
func rootOnForeignData(dir string) bool { return false }
