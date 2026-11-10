package api

import (
	"bufio"
	"fmt"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A client that trickles a request body in is cut off at the read
// deadline; the live stream is not.
func TestBodyReadDeadline(t *testing.T) {
	old := BodyReadTimeout
	BodyReadTimeout = 300 * time.Millisecond
	defer func() { BodyReadTimeout = old }()
	e := newAuthEnv(t)
	ts := httptest.NewServer(e.srv)
	defer ts.Close()
	c, err := net.Dial("tcp", ts.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	fmt.Fprintf(c, "POST /api/invites/peek HTTP/1.1\r\nHost: %s\r\nOrigin: %s\r\nX-Topo: 1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{\"tok", e.host, e.origin)
	start := time.Now()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	// Keep trickling: one byte every 100 ms. The server must give up.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 40; i++ {
			time.Sleep(100 * time.Millisecond)
			if _, err := c.Write([]byte("e")); err != nil {
				return
			}
		}
	}()
	br := bufio.NewReader(c)
	line, _ := br.ReadString('\n')
	for {
		if _, err := br.ReadString('\n'); err != nil {
			break
		}
	}
	took := time.Since(start)
	if took > 3*time.Second {
		t.Fatalf("connection held %v with a trickled body (status line %q)", took, strings.TrimSpace(line))
	}
	<-done
}
