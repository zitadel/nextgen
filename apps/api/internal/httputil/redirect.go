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
//   - A browser treats "%2e" as a dot, and resolves dot segments in the path
//     as written, before anything decodes it, so "/%2e%2e//evil.example"
//     removes a segment and leaves "//evil.example".
//   - A path that starts with "//" is a network-path reference: once the scheme
//     and host are stripped, as a proxy that re-bases a Location header onto its
//     own host does, it names another host. A proxy or server that then decodes
//     the path sees "%2F" and "%5C" as slashes, and one that drops ";"
//     parameters, as Tomcat and Spring do, sees "/..;/" as "/../". A decoded
//     "?" or "#" ends the path for a reader that parses a URL. So the path is
//     followed through every reading, in any order and however many times,
//     and refused if any of them starts with "//".
//
// Only the scheme, userinfo, host, port and path are policed. The query and
// fragment are free-form, so a page that keeps state there still round-trips.
//
// The result is parsed from raw, with a '%' that starts no escape written as
// "%25", and a byte a Go parser would re-encode written as its escape, in the
// path and fragment; a browser and a server read both the same way. The query
// is left as written. The path keeps its escapes, nothing is decoded or
// resolved. The host is only checked for shape, not normalized, so forms a
// browser rewrites, such as a decimal IP address or a trailing dot, pass. The
// caller decides which hosts are acceptable, for example by comparing the
// origin with the request's.
func ParseRedirectTarget(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, refusal("it is empty")
	}
	if len(raw) > MaxRedirectTargetLength {
		return nil, refusal("it is too long: over %d bytes", MaxRedirectTargetLength)
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

	// A browser leaves a '%' that starts no escape as it is, and a Go parser
	// refuses it. Writing it as "%25" says the same thing to both.
	target := sanitize(raw)
	// Sanitizing can lengthen the target, and it is the sanitized form that is
	// stored and checked again later, so the limit holds for that form too.
	if len(target) > MaxRedirectTargetLength {
		return nil, refusal("it is longer than %d bytes once its escapes are written out", MaxRedirectTargetLength)
	}

	u, err := url.Parse(target)
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

	// The path is checked in the form that is stored and later redirected to.
	path, ok := pathOf(u.String(), u.Scheme)
	if !ok {
		return nil, refusal("it is not a URL")
	}
	if err := checkPath(path); err != nil {
		return nil, err
	}
	return u, nil
}

func refusal(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRedirectTarget, fmt.Sprintf(format, args...))
}

// sanitize writes the path and the fragment of raw so that a Go parser keeps
// them exactly as written: a '%' that starts no two-digit hex escape becomes
// "%25", and a byte Go would otherwise re-encode ('"', '<', '>', '^', '`', '{',
// '|', '}', and in a fragment also a backslash and a second '#') becomes its
// escape. Go re-encodes a whole path that holds such a byte, and in doing so
// turns every "%2F" into a slash, which would change what the URL means. The
// query is left verbatim, as no parser polices it.
func sanitize(raw string) string {
	var b strings.Builder
	b.Grow(len(raw) + 8)
	inQuery, inFragment := false, false
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		switch {
		case c == '#' && !inFragment:
			inQuery, inFragment = false, true
		case c == '#' && inFragment:
			b.WriteString("%23")
			continue
		case c == '?' && !inFragment:
			inQuery = true
		}
		if inQuery {
			b.WriteByte(c)
			continue
		}
		switch {
		case c == '%' && !isEscapeAt(raw, i):
			b.WriteString("%25")
		case strings.IndexByte("\"<>^`{|}", c) >= 0 || c == '\\' && inFragment:
			fmt.Fprintf(&b, "%%%02X", c)
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

func isEscapeAt(s string, i int) bool {
	if i+2 >= len(s) {
		return false
	}
	_, hi := unhex(s[i+1])
	_, lo := unhex(s[i+2])
	return hi && lo
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

// pathOf returns the path of an absolute URL exactly as it is written in s:
// what follows the authority, up to the query or fragment. It is empty when
// the URL has none. scheme is the URL's lowercase scheme; s may spell it in
// any case.
func pathOf(s, scheme string) (string, bool) {
	prefix := len(scheme) + len("://")
	if len(s) < prefix || !strings.EqualFold(s[:len(scheme)], scheme) || s[len(scheme):prefix] != "://" {
		return "", false
	}
	rest := s[prefix:]
	start := strings.IndexAny(rest, "/?#")
	if start < 0 || rest[start] != '/' {
		return "", true
	}
	rest = rest[start:]
	if end := strings.IndexAny(rest, "?#"); end >= 0 {
		rest = rest[:end]
	}
	return rest, true
}

// maxReadings bounds how many distinct texts checkPath follows. An honest path
// has a handful; a path that fans out further is refused rather than half
// checked.
const maxReadings = 64

// checkPath refuses a path that any reader would take to start with an empty
// segment, which reads as another host once the scheme and host are removed.
//
// A browser resolves dot segments in the path as written, before anything
// decodes it, and a server that decodes before it routes may resolve again,
// read a backslash as a slash, drop ";" path parameters as a Tomcat or Spring
// layer does, treat a "?" or "#" that decoding produced as the end of the path,
// and decode again. So every text reachable from the path by decoding,
// resolving dot segments, reading backslashes as slashes, dropping path
// parameters and cutting at a query or fragment mark, in any order and any
// number of times, is tested for a leading "//".
// No step lengthens a text, and a text is never followed twice, so the walk
// ends; a path that fans out into more than maxReadings texts is refused.
func checkPath(path string) error {
	seen := map[string]bool{path: true}
	pending := []string{path}
	for len(pending) > 0 {
		text := pending[0]
		pending = pending[1:]
		if strings.HasPrefix(strings.ReplaceAll(text, `\`, "/"), "//") {
			return refusal("its path starts with an empty segment, which reads as another host")
		}
		decoded := unescapeLeniently(text)
		steps := []string{decoded, resolveDots(text), strings.ReplaceAll(text, `\`, "/"), dropParameters(text), cutAtQuery(text),
			onPath(text, resolveDots), onPath(text, dropParameters)}
		for _, step := range steps {
			if seen[step] {
				continue
			}
			if step == decoded {
				for i := 0; i < len(step); i++ {
					if step[i] < ' ' || step[i] == 0x7f {
						return refusal("its path decodes to a control character")
					}
				}
			}
			if len(seen) >= maxReadings {
				return refusal("its path has too many readings to check")
			}
			seen[step] = true
			pending = append(pending, step)
		}
	}
	return nil
}

// cutAtQuery returns p up to its first "?" or "#", which is where a reader that
// parses a URL out of a decoded text ends the path.
func cutAtQuery(p string) string {
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		return p[:i]
	}
	return p
}

// onPath applies f to the part of p before its first "?" or "#" and keeps the
// rest as it is: a reader that ends the path at a decoded "?" for one step may
// treat the same mark as an ordinary character in the next.
func onPath(p string, f func(string) string) string {
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		return f(p[:i]) + p[i:]
	}
	return f(p)
}

// dropParameters removes the ";..." path parameters from every segment of p, so
// "/a/..;/x" reads as "/a/../x".
func dropParameters(p string) string {
	if !strings.Contains(p, ";") {
		return p
	}
	segments := strings.Split(p, "/")
	for i, segment := range segments {
		if j := strings.IndexByte(segment, ';'); j >= 0 {
			segments[i] = segment[:j]
		}
	}
	return strings.Join(segments, "/")
}

// resolveDots removes the dot segments from p the way the URL standard does:
// "." and ".." in any mix of literal and percent-encoded dots, in any case. A
// p that does not start with a slash is returned unchanged.
func resolveDots(p string) string {
	if !strings.HasPrefix(p, "/") {
		return p
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
	return "/" + strings.Join(resolved, "/")
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

// unescapeLeniently decodes every valid %XX escape in s and leaves any other
// '%' alone, as a lenient decoder does. url.PathUnescape fails the whole string
// on one bad escape, which would let a stray '%' hide a later %2F from the
// check.
func unescapeLeniently(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '%' && isEscapeAt(s, i) {
			hi, _ := unhex(s[i+1])
			lo, _ := unhex(s[i+2])
			b.WriteByte(hi<<4 | lo)
			i += 2
			continue
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
