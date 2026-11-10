package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// certCheckInterval is how often the certificate files' modification times
// are compared. Renewals (certbot, tailscale cert) are rare.
var certCheckInterval = time.Hour

// certReloader hands the current key pair to TLS handshakes and swaps it
// when the files change (hourly check, or SIGHUP where there is one). A
// failed reload keeps the previous pair.
type certReloader struct {
	certFile, keyFile string
	log               *slog.Logger

	mu      sync.RWMutex
	cert    *tls.Certificate
	modCert time.Time
	modKey  time.Time
}

// newCertReloader loads the pair once. A first load that fails is fatal
// (a server that only answers TLS errors must not look healthy); later
// reloads keep the previous pair on failure.
func newCertReloader(certFile, keyFile string, log *slog.Logger) (*certReloader, error) {
	c := &certReloader{certFile: certFile, keyFile: keyFile, log: log}
	if err := c.reload(); err != nil {
		return nil, fmt.Errorf("tls certificate %s / key %s (they must be readable by the user the server runs as): %w", certFile, keyFile, err)
	}
	return c, nil
}

func (c *certReloader) reload() error {
	mc, mk := modTime(c.certFile), modTime(c.keyFile)
	pair, err := tls.LoadX509KeyPair(c.certFile, c.keyFile)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.cert, c.modCert, c.modKey = &pair, mc, mk
	c.mu.Unlock()
	return nil
}

func (c *certReloader) changed() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.cert == nil || !modTime(c.certFile).Equal(c.modCert) || !modTime(c.keyFile).Equal(c.modKey)
}

func (c *certReloader) getCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.cert == nil {
		return nil, errors.New("no tls certificate loaded")
	}
	return c.cert, nil
}

func (c *certReloader) tlsConfig() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: c.getCertificate}
}

func (c *certReloader) watch(ctx context.Context) {
	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	defer signal.Stop(hup)
	tick := time.NewTicker(certCheckInterval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-hup:
			c.try("signal")
		case <-tick.C:
			if c.changed() {
				c.try("files changed")
			}
		}
	}
}

func (c *certReloader) try(why string) {
	if err := c.reload(); err != nil {
		c.log.Error("tls certificate reload failed; keeping the previous one", "why", why, "err", err)
		return
	}
	c.log.Info("tls certificate reloaded", "why", why)
}

func modTime(path string) time.Time {
	st, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return st.ModTime()
}
