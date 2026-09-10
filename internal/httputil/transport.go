package httputil

import (
	"net"
	"net/http"
	"syscall"
	"time"
)

// newTransport returns a cloned default transport that enforces the policy
// right before each TCP dial, closing the DNS-rebinding TOCTOU gap: the
// Control hook runs after name resolution, on the exact IP the kernel is
// about to connect to, for every connection the transport makes — redirect
// hops included. (Ported from zitadel/zitadel's fix for GHSA-29jh-8cfq-rr8x.)
func newTransport(policy *Policy) http.RoundTripper {
	base := http.DefaultTransport.(*http.Transport).Clone()
	if !policy.Enforces() {
		return base
	}
	dialer := &net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(network, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			parsedIP := net.ParseIP(host)
			if parsedIP == nil { // at this point it must be an IP, so this should never happen
				return &net.DNSError{Err: "invalid IP address", Name: host}
			}
			return policy.Check([]net.IP{parsedIP}, host)
		},
	}
	base.DialContext = dialer.DialContext
	return base
}
