package oauth

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMatchRedirectURI(t *testing.T) {
	registered := []string{
		"http://127.0.0.1/callback",
		"http://[::1]/callback",
		"http://localhost/callback",
		"https://app.example.com/callback",
		"http://localhost:6274/oauth/callback?client=inspector",
	}
	tests := []struct {
		name      string
		requested string
		ok        bool
	}{
		{"a registered URI as it is", "https://app.example.com/callback", true},
		{"a loopback IPv4 URI on any port (RFC 8252 §7.3)", "http://127.0.0.1:53142/callback", true},
		{"a loopback IPv6 URI on any port", "http://[::1]:53142/callback", true},
		{"localhost on any port", "http://localhost:8080/callback", true},
		{"a loopback URI with its registered query", "http://localhost:6275/oauth/callback?client=inspector", true},
		{"a loopback URI on another path", "http://127.0.0.1:53142/other", false},
		{"a loopback URI with another query", "http://127.0.0.1:53142/callback?x=1", false},
		{"a loopback URI over https, registered as http", "https://127.0.0.1:53142/callback", false},
		{"another loopback host than the registered one", "http://127.0.0.2:53142/callback", false},
		{"a non-loopback URI on another port", "https://app.example.com:8443/callback", false},
		{"a non-loopback URI on another path", "https://app.example.com/callback/x", false},
		{"another host", "https://evil.example/callback", false},
		{"a host that ends like a registered one", "https://app.example.com.evil.example/callback", false},
		{"userinfo in front of a registered host", "https://evil.example@app.example.com/callback", false},
		{"a backslash a browser reads as a slash", `https://app.example.com\@evil.example/callback`, false},
		{"a fragment", "https://app.example.com/callback#x", false},
		{"a custom scheme", "com.example.app:/callback", false},
		{"nothing", "", false},
		// Zitadel v4 decoded redirect_uri twice to check it and redirected to
		// the once-decoded value. These are what reaches the matcher, already
		// decoded once by the request; none is decoded again.
		{"v4's double-encoded loopback path and fragment, as userinfo", "http://127.0.0.1%2Fcallback%23@attacker.example/", false},
		{"the same value decoded twice", "http://127.0.0.1/callback#@attacker.example/", false},
		{"an encoded at sign in the host", "http://127.0.0.1%40attacker.example:53142/callback", false},
		{"an encoded path and fragment after the loopback host", "http://127.0.0.1:53142/callback%23@attacker.example/", false},
		{"an encoded letter in the path", "http://127.0.0.1:53142/%63allback", false},
		{"a double-encoded letter in the path", "http://127.0.0.1:53142/%2563allback", false},
		{"empty userinfo", "http://@127.0.0.1:53142/callback", false},
		{"an empty fragment", "http://127.0.0.1:53142/callback#", false},
		{"another spelling of the loopback address", "http://2130706433:53142/callback", false},
		{"localhost with a trailing dot", "http://localhost.:53142/callback", false},
		{"localhost in capitals, not the registered spelling", "http://LOCALHOST:53142/callback", false},
		{"an uppercase scheme, which is not its own canonical form", "HTTP://127.0.0.1:53142/callback", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, ok := matchRedirectURI(registered, tt.requested)
			assert.Equal(t, tt.ok, ok)
		})
	}
}

// The answer goes to the registered URI with its own query as it was
// registered and checked: parameters follow it, nothing re-encodes it.
func TestAnswersKeepTheRedirectURIsQuery(t *testing.T) {
	registered := "http://127.0.0.1:51234/callback?z=1&path=%2Fhome&a=b+c"
	target, ok := matchRedirectURI([]string{registered}, registered)
	require.True(t, ok)
	s := &Server{issuer: "https://zitadel.example.com"}

	assert.Equal(t, registered+"&code=abc&iss=https%3A%2F%2Fzitadel.example.com",
		withParams(target, url.Values{"code": {"abc"}, "iss": {s.issuer}}))
	assert.Equal(t, registered+"&error=access_denied&iss=https%3A%2F%2Fzitadel.example.com&state=xyz",
		s.errorRedirectURL(target, "xyz", "access_denied", ""))

	bare, ok := matchRedirectURI([]string{"http://127.0.0.1/callback"}, "http://127.0.0.1:51234/callback")
	require.True(t, ok)
	assert.Equal(t, "http://127.0.0.1:51234/callback?code=abc", withParams(bare, url.Values{"code": {"abc"}}))
}
