// Package httputil provides the hardened egress HTTP client for every fetch
// of a URL a platform user can inject (schema ingestion today; social login
// and tenant webhooks later). Endpoints only the operator configures
// (telemetry collectors, the audit export sink) stay on standard-library
// clients: the guard exists against server-side request forgery, which
// requires a user-controlled URL.
//
// The package deliberately imports nothing repo-specific so it can be
// promoted to a shared library by copying (see the egress-policy ADR).
package httputil

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultDenyList blocks loopback, private, link-local (cloud metadata),
// carrier-grade NAT, benchmark, and unspecified ranges, IPv4 and IPv6, plus
// the "localhost" hostname. Aligned with zitadel/zitadel's
// HTTPClient.DenyList (GHSA-29jh-8cfq-rr8x). The hostname entry is
// belt-and-braces for the URL layer; the CIDRs are what block at dial time,
// where every name is already resolved — do not remove one because the other
// looks equivalent.
var DefaultDenyList = []string{
	"localhost",
	"0.0.0.0/8",      // unspecified IPv4 range / local network routing trick protection
	"10.0.0.0/8",     // class A private networks
	"100.64.0.0/10",  // carrier-grade NAT space
	"127.0.0.0/8",    // IPv4 loopback
	"169.254.0.0/16", // link-local, covers cloud metadata endpoints like 169.254.169.254
	"172.16.0.0/12",  // class B private networks
	"192.168.0.0/16", // class C private networks
	"198.18.0.0/15",  // benchmark / inter-network testing
	"::/128",         // unspecified IPv6 address
	"::1/128",        // IPv6 loopback
	"fc00::/7",       // unique local addresses, IPv6 private equivalent
	"fe80::/10",      // IPv6 link-local, metadata equivalent
}

var (
	// ErrResponseTooLarge is returned when the response body exceeds the configured limit.
	ErrResponseTooLarge = errors.New("response body exceeded maximum allowed size")
	// ErrTooManyRedirects is returned when the number of redirects exceeds the configured limit.
	ErrTooManyRedirects = errors.New("stopped after too many redirects")
	// ErrHTTPSDowngrade is returned when a redirect attempts to downgrade from https to http.
	ErrHTTPSDowngrade = errors.New("redirect downgrade from https to http is not allowed")
)

// ClientConfig builds a hardened egress client. The zero value enforces
// nothing; defaults are the config loader's job.
type ClientConfig struct {
	// MaxBodySize caps each response body in bytes; 0 means unlimited.
	MaxBodySize int64 `mapstructure:"max_body_size"`
	// Timeout bounds each single request; 0 means unlimited.
	Timeout time.Duration `mapstructure:"timeout"`
	// MaxRedirects caps redirect hops; 0 refuses all redirects.
	MaxRedirects int `mapstructure:"max_redirects"`
	// AllowHTTPSDowngrade permits an https request to redirect to http.
	AllowHTTPSDowngrade bool `mapstructure:"allow_https_downgrade"`
	// DenyList entries (CIDR, IP, or hostname) block matching targets.
	DenyList []string `mapstructure:"deny_list"`
	// AllowList entries re-allow targets the deny list blocks, e.g.
	// "localhost" plus "127.0.0.0/8" for local development.
	AllowList []string `mapstructure:"allow_list"`
}

// Validate parses both lists so a malformed entry fails at startup, not at
// first fetch, and rejects negative limits: a negative max_body_size would
// silently disable the response cap.
func (c ClientConfig) Validate() error {
	if c.MaxBodySize < 0 {
		return fmt.Errorf("max_body_size must not be negative, got %d", c.MaxBodySize)
	}
	if c.Timeout < 0 {
		return fmt.Errorf("timeout must not be negative, got %s", c.Timeout)
	}
	if c.MaxRedirects < 0 {
		return fmt.Errorf("max_redirects must not be negative, got %d", c.MaxRedirects)
	}
	_, err := NewPolicy(c.DenyList, c.AllowList)
	return err
}

// NewClient returns an *http.Client protected against DNS rebinding (the
// dial-time policy check on the resolved IP), hostname-denied targets (a
// pre-connection check on every request, redirect hops included), redirect
// abuse (hop cap, downgrade block), and oversized responses.
func (c ClientConfig) NewClient() (*http.Client, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	policy, err := NewPolicy(c.DenyList, c.AllowList)
	if err != nil {
		return nil, err
	}
	var transport http.RoundTripper = newTransport(policy)
	if policy.Enforces() {
		// Hostname-level check on every request — the initial one and each
		// redirect hop reissue through RoundTrip — so hostname entries take
		// effect before any connection. Resolved IPs stay the dial hook's job.
		transport = &policyRoundTripper{underlying: transport, policy: policy}
	}
	if c.MaxBodySize > 0 {
		transport = &maxBytesRoundTripper{underlying: transport, maxBytes: c.MaxBodySize}
	}
	return &http.Client{
		Transport: transport,
		Timeout:   c.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > c.MaxRedirects {
				return ErrTooManyRedirects
			}
			if !c.AllowHTTPSDowngrade && len(via) > 0 {
				prev := via[len(via)-1]
				if prev != nil && prev.URL != nil && req.URL != nil &&
					strings.EqualFold(prev.URL.Scheme, "https") &&
					!strings.EqualFold(req.URL.Scheme, "https") {
					return ErrHTTPSDowngrade
				}
			}
			return nil
		},
	}, nil
}

// policyRoundTripper rejects a request whose URL hostname the policy denies,
// before any connection is opened.
type policyRoundTripper struct {
	underlying http.RoundTripper
	policy     *Policy
}

var _ http.RoundTripper = (*policyRoundTripper)(nil)

func (p *policyRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if err := p.policy.CheckAddress(req.URL.Hostname()); err != nil {
		return nil, err
	}
	return p.underlying.RoundTrip(req)
}

// maxBytesRoundTripper wraps a RoundTripper to protect against OOM on
// unbounded response bodies.
type maxBytesRoundTripper struct {
	underlying http.RoundTripper
	maxBytes   int64
}

var _ http.RoundTripper = (*maxBytesRoundTripper)(nil)

func (m *maxBytesRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := m.underlying.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if resp.ContentLength > m.maxBytes {
		resp.Body.Close()
		return nil, fmt.Errorf("%w: Content-Length is %d (limit %d)", ErrResponseTooLarge, resp.ContentLength, m.maxBytes)
	}
	resp.Body = &strictMaxBytesReader{
		// +1 so an overflow is observable during Read instead of silently truncated.
		limitReader: io.LimitReader(resp.Body, m.maxBytes+1),
		closer:      resp.Body,
		limit:       m.maxBytes,
	}
	return resp, nil
}

// strictMaxBytesReader enforces a hard limit and returns an explicit error if
// exceeded, so callers that ignore limits still fail loudly.
type strictMaxBytesReader struct {
	limitReader io.Reader
	closer      io.Closer
	limit       int64
	bytesRead   int64
}

var _ io.ReadCloser = (*strictMaxBytesReader)(nil)

func (s *strictMaxBytesReader) Read(p []byte) (int, error) {
	n, err := s.limitReader.Read(p)
	s.bytesRead += int64(n)
	if s.bytesRead > s.limit {
		// LimitReader stops at limit+1, so the excess is exactly one byte;
		// slice it off the caller's view and surface the error instead.
		return max(n-1, 0), ErrResponseTooLarge
	}
	return n, err
}

func (s *strictMaxBytesReader) Close() error {
	return s.closer.Close()
}
