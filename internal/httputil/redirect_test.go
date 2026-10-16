package httputil_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/httputil"
)

func TestParseRedirectTarget_Accepts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		raw      string
		wantHost string
	}{
		{"a page with a flow handle", "https://app.test/login?flow=f1", "app.test"},
		{"the root with a path", "https://app.test/", "app.test"},
		{"no path at all", "https://app.test", "app.test"},
		{"a hash-routed page keeps its fragment", "http://localhost:5173/#/profile", "localhost:5173"},
		{"an uppercase scheme and host", "HTTPS://App.Test/x", "App.Test"},
		{"an IPv6 literal with a port", "https://[::1]:8443/x", "[::1]:8443"},
		{"a double slash deeper in the path", "https://app.test/app//login", "app.test"},
		{"an encoded slash inside a segment", "https://app.test/a%2Fb", "app.test"},
		{"an encoded percent sign at the end", "https://app.test/discount/100%25", "app.test"},
		{"an encoded percent sign before letters", "https://app.test/a%25zz", "app.test"},
		{"only an encoded percent sign", "https://app.test/%25", "app.test"},
		{"a parent segment that stays on the path", "https://app.test/a/../b", "app.test"},
		{"a dot segment at the end", "https://app.test/a/.", "app.test"},
		{"a parent segment that returns to the root", "https://app.test/app/../", "app.test"},
		{"a backslash in the query", `https://app.test/x?next=\evil`, "app.test"},
		{"a double slash in the query", "https://app.test/x?next=//evil.example", "app.test"},
		{"a double slash in the fragment", "https://app.test/x#//evil.example", "app.test"},
		{"an underscore in the host", "https://my_app.test/x", "my_app.test"},
		{"the highest port", "https://app.test:65535/x", "app.test:65535"},
		{"an empty port", "https://app.test:/x", "app.test:"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			u, err := httputil.ParseRedirectTarget(tt.raw)
			require.NoError(t, err)
			assert.Equal(t, tt.wantHost, u.Host)
		})
	}
}

func TestParseRedirectTarget_Refuses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		raw  string
		why  string
	}{
		{"nothing", "", "empty"},
		{"too long", "https://app.test/" + strings.Repeat("a", httputil.MaxRedirectTargetLength), "longer than"},

		{"a relative path", "/login", "scheme"},
		{"a scheme-relative URL", "//app.test/x", "scheme"},
		{"no scheme", "app.test/login", "scheme"},
		{"javascript", "javascript:alert(1)", "scheme"},
		{"a data URL", "data:text/html,x", "scheme"},
		{"ftp", "ftp://app.test/x", "scheme"},
		{"an opaque URL", "https:evil.example", "no host"},
		{"no host", "https:///x", "no host"},
		{"unparseable", "https://app.test/%zz", "not a URL"},
		{"a bracketed host that is not an IP", "https://[evil]/x", "not a URL"},
		{"a port and no host", "https://:80/x", "no host"},

		{"userinfo", "https://user@app.test/x", "userinfo"},
		{"the origin as userinfo", "https://app.test@evil.example/x", "userinfo"},
		{"userinfo with a password", "https://user:pw@app.test/x", "userinfo"},
		{"a backslash before an at sign", `https://evil.example\@app.test/x`, "backslash"},
		{"a backslash after the host", `https://app.test\evil.example/x`, "backslash"},

		{"a space in the host", "https://app test/x", "control, space or non-ASCII"},
		{"a tab in the path", "https://app.test/\t/evil.example", "control, space or non-ASCII"},
		{"a newline in the path", "https://app.test/\n/evil.example", "control, space or non-ASCII"},
		{"a carriage return in the query", "https://app.test/x?a=\r", "control, space or non-ASCII"},
		{"a NUL byte", "https://app.test/\x00", "control, space or non-ASCII"},
		{"a delete character", "https://app.test/\x7f", "control, space or non-ASCII"},
		{"a non-ASCII query", "https://app.test/x?q=é", "control, space or non-ASCII"},
		{"a fullwidth host", "https://ａpp.test/x", "control, space or non-ASCII"},
		{"a fullwidth slash", "https://app.test／evil.example", "control, space or non-ASCII"},

		{"an encoded dot in the host", "https://app%2etest/x", "not a URL"},
		{"a host with an exclamation mark", "https://app!test/x", "character other than"},
		{"an IPv6 zone", "https://[fe80::1%25eth0]/x", "plain IP literal"},
		{"a port out of range", "https://app.test:65536/x", "port"},
		{"a huge port", "https://app.test:99999999999/x", "port"},

		{"two slashes", "https://app.test//evil.example/login", "empty segment"},
		{"three slashes", "https://app.test///evil.example", "empty segment"},
		{"only two slashes", "https://app.test//", "empty segment"},
		{"a slash and a backslash", `https://app.test/\evil.example/login`, "backslash"},
		{"a dot segment before two slashes", "https://app.test/.//evil.example/login", "empty segment"},
		{"a parent segment before two slashes", "https://app.test/app/..//evil.example/login", "empty segment"},
		{"an encoded dot before two slashes", "https://app.test/%2e//evil.example", "empty segment"},
		{"an uppercase encoded dot", "https://app.test/%2E//evil.example", "empty segment"},
		{"an encoded parent segment", "https://app.test/app/%2e%2e//evil.example", "empty segment"},
		{"a half-encoded parent segment", "https://app.test/app/.%2e//evil.example", "empty segment"},
		{"the other half-encoded parent segment", "https://app.test/app/%2e.//evil.example", "empty segment"},

		{"an encoded slash first", "https://app.test/%2Fevil.example", "decodes"},
		{"an encoded backslash first", "https://app.test/%5Cevil.example", "decodes"},
		{"a lowercase encoded backslash", "https://app.test/%5cevil.example", "decodes"},
		{"a double-encoded slash", "https://app.test/%252Fevil.example", "decodes"},
		{"a double-encoded backslash", "https://app.test/%255Cevil.example", "decodes"},
		{"an encoded tab", "https://app.test/%09/evil.example", "control character"},
		{"an encoded newline", "https://app.test/a%0Ab", "control character"},
		{"an encoded NUL", "https://app.test/%00", "control character"},
		{"a double-encoded tab", "https://app.test/%2509/x", "control character"},
		{"a stray percent sign after a double-encoded slash", "https://app.test/%252F%25zz", "decodes"},
		{"an invalid escape", "https://app.test/%", "not a URL"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			u, err := httputil.ParseRedirectTarget(tt.raw)
			require.ErrorIs(t, err, httputil.ErrInvalidRedirectTarget)
			assert.ErrorContains(t, err, tt.why)
			assert.Nil(t, u)
		})
	}
}

func TestParseRedirectTarget_ReturnsTheTargetAsWritten(t *testing.T) {
	t.Parallel()

	u, err := httputil.ParseRedirectTarget("HTTPS://app.test/a%2Fb/%2e%2e/c?next=%2Fprofile#/step")
	require.NoError(t, err)
	// Nothing in the path or the query is decoded or resolved: a caller that
	// stores the target stores what the page sent.
	assert.Equal(t, "/a%2Fb/%2e%2e/c", u.EscapedPath())
	assert.Equal(t, "next=%2Fprofile", u.RawQuery)
	assert.Equal(t, "/step", u.Fragment)
	// Only the scheme is folded, as the URL standard does.
	assert.Equal(t, "https", u.Scheme)
}
