package httputil

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"strings"
)

// ErrInvalidRedirectTarget is wrapped by every refusal from
// [ParseRedirectTarget]; the wrapping message says why.
var ErrInvalidRedirectTarget = errors.New("not a valid redirect target")

// MaxRedirectTargetLength is the longest redirect target accepted, in bytes.
// It matches the maxLength the API spec gives return_target.
const MaxRedirectTargetLength = 2048

// maxPort is the highest TCP port a URL can name.
const maxPort = 65535

// ParseRedirectTarget parses raw as an absolute http(s) URL the server may send
// a browser to, and refuses anything a browser or a proxy could read as a
// different place than the one the URL names. It is the single place that
// decides this, so every redirect the server issues from caller input goes
// through it.
//
// A redirect target is untrusted input. It is checked in the form a browser
// reads it, not the form a Go parser reads it, because the two disagree and an
// open redirect lives in the gap:
//
//   - A browser drops tabs and newlines inside a URL and reads a backslash as a
//     slash, so "/<TAB>/evil.example" and "/\evil.example" both become
//     "//evil.example". Any byte outside printable ASCII is refused, and so is a
//     backslash in the authority or path.
//   - A browser treats "%2e" as a dot, so "/%2e%2e//evil.example" removes a
//     segment and leaves "//evil.example". Dot segments are resolved, encoded
//     ones included, before the result is checked.
//   - A path that starts with "//" is a network-path reference: once the scheme
//     and host are stripped, as a proxy that re-bases a Location header onto its
//     own host does, it names another host. A path whose percent-decoded form
//     (decoded up to twice, for a server that decodes before it routes) starts
//     that way is refused too.
//
// Only the scheme, userinfo, host, port and path are policed. The query and
// fragment are free-form, so a page that keeps state there still round-trips.
//
// The result is parsed from raw as given: its path keeps its escapes as
// written, nothing is decoded or rewritten. The host is only checked for
// shape, not normalized, so forms a browser rewrites, such as a decimal IP
// address or a trailing dot, pass. The caller decides which hosts are
// acceptable, for example by comparing the origin with the request's.
func ParseRedirectTarget(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, refusal("it is empty")
	}
	if len(raw) > MaxRedirectTargetLength {
		return nil, refusal("it is longer than %d bytes", MaxRedirectTargetLength)
	}
	// Printable ASCII only. Every legitimate target is a page URL a browser has
	// already percent-encoded, and anything else is either ignored by a browser
	// (tab, newline) or read differently by it than by this server.
	for i := 0; i < len(raw); i++ {
		if c := raw[i]; c <= ' ' || c >= 0x7f {
			return nil, refusal("it contains a control, space or non-ASCII byte at offset %d", i)
		}
	}

	// Checked before parsing, so the answer does not depend on what a Go parser
	// happens to reject. A browser reads a backslash before the query as a
	// slash, which moves the end of the authority: https://evil.example\@app.test
	// is evil.example to a browser and app.test to a parser that sees a userinfo.
	hierarchical := raw
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		hierarchical = raw[:i]
	}
	if strings.Contains(hierarchical, `\`) {
		return nil, refusal("its authority or path contains a backslash")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return nil, refusal("it is not a URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, refusal("its scheme is not http or https")
	}
	if u.Opaque != "" || u.Host == "" {
		return nil, refusal("it has no host")
	}
	if u.User != nil {
		return nil, refusal("it carries userinfo")
	}
	if err := checkHost(u); err != nil {
		return nil, err
	}

	if err := checkPath(u.EscapedPath()); err != nil {
		return nil, err
	}
	return u, nil
}

func refusal(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRedirectTarget, fmt.Sprintf(format, args...))
}

// checkHost accepts an ASCII host name, an IPv4 address or an unzoned IPv6
// literal, with an optional port in range.
func checkHost(u *url.URL) error {
	host := u.Hostname()
	if host == "" {
		return refusal("it has no host")
	}
	if strings.HasPrefix(u.Host, "[") {
		addr, err := netip.ParseAddr(host)
		if err != nil || addr.Zone() != "" {
			return refusal("its host is not a plain IP literal")
		}
	} else {
		for i := 0; i < len(host); i++ {
			c := host[i]
			ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
				c == '.' || c == '-' || c == '_'
			if !ok {
				return refusal("its host contains a character other than letters, digits, dot, dash and underscore")
			}
		}
	}
	if port := u.Port(); port != "" {
		n := 0
		for i := 0; i < len(port); i++ {
			n = n*10 + int(port[i]-'0')
			if n > maxPort {
				return refusal("its port is out of range")
			}
		}
	}
	return nil
}

// checkPath refuses a path that reads as the start of another host. escaped is
// the path as written, with its percent-escapes intact.
func checkPath(escaped string) error {
	if readsAsAuthority(escaped) {
		return refusal("its path starts with an empty segment, which reads as another host")
	}
	// A server that decodes a path before routing it, or a proxy that does, sees
	// the decoded form. Once for %2F and %5C, twice for their double encodings.
	// A '%' that does not start an escape stays as it is, as a lenient decoder
	// leaves it, so a path such as /100%25 (a literal percent sign) is not
	// mistaken for a malformed one.
	decoded := escaped
	for pass := 0; pass < 2; pass++ {
		decoded = unescapeLeniently(decoded)
		for i := 0; i < len(decoded); i++ {
			if decoded[i] < ' ' || decoded[i] == 0x7f {
				return refusal("its path decodes to a control character")
			}
		}
		if readsAsAuthority(strings.ReplaceAll(decoded, `\`, "/")) {
			return refusal("its path decodes to one that starts with an empty segment, which reads as another host")
		}
	}
	return nil
}

// unescapeLeniently decodes every valid %XX escape in s and leaves any other
// '%' alone. url.PathUnescape fails the whole string on one bad escape, which
// would let a stray '%' hide a later %2F from the check.
func unescapeLeniently(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '%' && i+2 < len(s) {
			hi, okHi := unhex(s[i+1])
			lo, okLo := unhex(s[i+2])
			if okHi && okLo {
				b.WriteByte(hi<<4 | lo)
				i += 2
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

func unhex(c byte) (byte, bool) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', true
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, true
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
}

// readsAsAuthority reports whether p, once a browser has resolved its dot
// segments, starts with "//". p is either escaped or already decoded, and a
// "%2e" counts as a dot in both.
func readsAsAuthority(p string) bool {
	if !strings.HasPrefix(p, "/") {
		return false
	}
	segments := strings.Split(p[1:], "/")
	resolved := make([]string, 0, len(segments))
	for i, segment := range segments {
		final := i == len(segments)-1
		switch dotSegment(segment) {
		case singleDot:
			if final {
				resolved = append(resolved, "")
			}
		case doubleDot:
			if len(resolved) > 0 {
				resolved = resolved[:len(resolved)-1]
			}
			if final {
				resolved = append(resolved, "")
			}
		default:
			resolved = append(resolved, segment)
		}
	}
	return len(resolved) > 1 && resolved[0] == ""
}

type dotKind int

const (
	notDot dotKind = iota
	singleDot
	doubleDot
)

// dotSegment classifies a path segment the way the URL standard does: "." and
// ".." in any mix of literal and percent-encoded dots, case-insensitively.
func dotSegment(segment string) dotKind {
	switch strings.ToLower(segment) {
	case ".", "%2e":
		return singleDot
	case "..", ".%2e", "%2e.", "%2e%2e":
		return doubleDot
	default:
		return notDot
	}
}
