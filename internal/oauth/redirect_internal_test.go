package oauth

import (
	"testing"

	"github.com/stretchr/testify/assert"
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
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, ok := matchRedirectURI(registered, tt.requested)
			assert.Equal(t, tt.ok, ok)
		})
	}
}
