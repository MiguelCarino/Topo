package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"carino.systems/topo/server/internal/config"
)

// healthcheck asks the server on this machine for /api/health (the
// container's HEALTHCHECK, so the image needs no curl). It dials loopback
// on the configured port; with built-in TLS it speaks https without checking
// the certificate, which is safe because it never leaves the machine.
func healthcheck(cfg *config.Config) error {
	host, port, err := net.SplitHostPort(cfg.Listen)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); host == "" || ip != nil && ip.IsUnspecified() {
		host = "127.0.0.1" // listening everywhere: loopback is one of them
	}
	scheme := "http"
	tr := &http.Transport{Proxy: nil, DisableKeepAlives: true}
	if cfg.TLSCert != "" {
		scheme = "https"
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // loopback only
	}
	c := &http.Client{Timeout: 5 * time.Second, Transport: tr}
	resp, err := c.Get(scheme + "://" + net.JoinHostPort(host, port) + "/api/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	var h struct {
		OK     bool   `json:"ok"`
		Server string `json:"server"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return err
	}
	if !h.OK || h.Server != "topo" {
		return fmt.Errorf("not a healthy Topo server")
	}
	return nil
}
