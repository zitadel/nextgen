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
		{"a percent sign that starts no escape in the path", "https://app.test/50%off", "app.test"},
		{"two letters after a percent sign in the path", "https://app.test/%zz", "app.test"},
		{"a lone percent sign as the path", "https://app.test/%", "app.test"},
		{"a percent sign at the end of a fragment", "https://app.test/#100%", "app.test"},
		{"a percent sign before letters in a fragment", "https://app.test/#/a%zz", "app.test"},
		{"a lone percent sign in a fragment", "https://app.test/#%", "app.test"},
		{"a percent sign and one digit in a fragment", "https://app.test/a?b#c%2", "app.test"},
		{"a parent segment that stays on the path", "https://app.test/a/../b", "app.test"},
		{"a dot segment at the end", "https://app.test/a/.", "app.test"},
		{"a parent segment that returns to the root", "https://app.test/app/../", "app.test"},
		{"a backslash in the query", `https://app.test/x?next=\evil`, "app.test"},
		{"a double slash in the query", "https://app.test/x?next=//evil.example", "app.test"},
		{"a double slash in the fragment", "https://app.test/x#//evil.example", "app.test"},
		{"an underscore in the host", "https://my_app.test/x", "my_app.test"},
		{"the highest port", "https://app.test:65535/x", "app.test:65535"},
		{"the authority followed by a query", "https://app.test?x=1", "app.test"},
		{"the authority followed by a fragment", "https://app.test#f", "app.test"},
		{"the authority followed by a query with slashes", "https://app.test?/..//x", "app.test"},
		{"a semicolon segment is an ordinary segment", "https://app.test/..;/x", "app.test"},
		{"stray percent signs around an escape", "https://app.test/%%41/%4/%41%", "app.test"},
		{"a stray percent sign in the query is left alone", "https://app.test/x?q=%zz&flow=1", "app.test"},
		{"a character a Go parser would re-encode", "https://app.test/a%2Fb|c", "app.test"},
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

		{"an encoded slash first", "https://app.test/%2Fevil.example", "empty segment"},
		{"an encoded backslash first", "https://app.test/%5Cevil.example", "empty segment"},
		{"a lowercase encoded backslash", "https://app.test/%5cevil.example", "empty segment"},
		{"a double-encoded slash", "https://app.test/%252Fevil.example", "empty segment"},
		{"a double-encoded backslash", "https://app.test/%255Cevil.example", "empty segment"},
		{"an encoded slash that survives a parent segment", "https://app.test/a%2Fb/../%2Fevil.example", "empty segment"},
		{"an encoded backslash that survives a parent segment", "https://app.test/a%5Cb/../%5Cevil.example", "empty segment"},
		{"a double-encoded slash that survives a parent segment", "https://app.test/a%252Fb/../%252Fevil.example", "empty segment"},
		{"several encoded slashes before parent segments", "https://app.test/x%2Fy%2Fz/../../%2Fevil.example", "empty segment"},
		{"an encoded slash followed by encoded parent segments", "https://app.test/%2Fevil.example%2F..%2F..%2F", "empty segment"},
		{"an encoded slash then parent segments with a literal slash", "https://app.test/%2Fevil.example/..%2F..%2F", "empty segment"},
		{"encoded backslashes and parent segments", "https://app.test/%5Cevil.example%5C..%5C..%5C", "empty segment"},
		{"an encoded slash then a parent segment", "https://app.test/%2F..", "empty segment"},
		{"an encoded slash then an encoded parent segment", "https://app.test/%2F%2e%2e/", "empty segment"},
		{"a character Go re-encodes before encoded slashes", "https://app.test/{%2F%2F/../%2Fevil.example", "empty segment"},
		{"two slashes with odd characters after them", `https://app.test//%2e.%2f":80`, "empty segment"},
		{"an encoded slash with a parent segment after it", "https://app.test/%2Fx/../y", "empty segment"},
		{"an encoded tab", "https://app.test/%09/evil.example", "control character"},
		{"an encoded newline", "https://app.test/a%0Ab", "control character"},
		{"an encoded NUL", "https://app.test/%00", "control character"},
		{"a double-encoded tab", "https://app.test/%2509/x", "control character"},
		{"an uppercase scheme before two slashes", "HTTPS://app.test//evil", "empty segment"},
		{"a double-encoded dot segment", "https://app.test/%252e%252e//evil", "empty segment"},
		{"everything encoded", "https://app.test/a/%2e%2e%2f%2fevil", "empty segment"},
		{"an encoded carriage return", "https://app.test/a%0Db", "control character"},
		{"an encoded delete character", "https://app.test/a%7Fb", "control character"},
		{"a slash that appears after a decode, a resolve and a decode", "https://app.test/.%2f%252F..", "empty segment"},
		{"another decode, resolve, decode order", "https://app.test/..%2F%255C..%252F", "empty segment"},
		{"a slash that appears after three decodes", "https://app.test/%25252Fevil.example", "empty segment"},
		{"a re-encoded character before encoded slashes", "https://app.test/..%2F%252F..%252F^b", "empty segment"},
		{"a stray percent sign after a double-encoded slash", "https://app.test/%252F%25zz", "empty segment"},
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

func TestParseRedirectTarget_WritesAStrayPercentSignAsAnEscape(t *testing.T) {
	t.Parallel()

	u, err := httputil.ParseRedirectTarget("https://app.test/50%off#100%")
	require.NoError(t, err)
	assert.Equal(t, "https://app.test/50%25off#100%25", u.String())
}

func TestParseRedirectTarget_KeepsEscapesWhereGoWouldReEncode(t *testing.T) {
	t.Parallel()

	tests := []struct{ name, raw, want string }{
		{"a bar after an encoded slash", "https://app.test/a%2Fb|c", "https://app.test/a%2Fb%7Cc"},
		{"a caret with a query", "https://app.test/a%2Fb^c?flow=1", "https://app.test/a%2Fb%5Ec?flow=1"},
		{"a bar in the fragment", "https://app.test/x#/a%2Fb|c", "https://app.test/x#/a%2Fb%7Cc"},
		{"a stray percent sign in the query", "https://app.test/x?q=100%", "https://app.test/x?q=100%"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			u, err := httputil.ParseRedirectTarget(tt.raw)
			require.NoError(t, err)
			assert.Equal(t, tt.want, u.String())
		})
	}
}

func TestParseRedirectTarget_RefusesAPathWithTooManyReadings(t *testing.T) {
	t.Parallel()

	_, err := httputil.ParseRedirectTarget("https://app.test/x%" + strings.Repeat("25", 100) + "2F")
	require.ErrorIs(t, err, httputil.ErrInvalidRedirectTarget)
}
