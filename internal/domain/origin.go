package domain

import (
	"net"
	"strings"
	"time"
)

const PrefixOrigin ResourcePrefix = "origin"

// OriginKind marks what a project origin pattern is for.
type OriginKind string

const (
	OriginKindPrimary OriginKind = "primary"
	OriginKindPreview OriginKind = "preview"
)

// Origin is one entry of a project's origin allowlist.
type Origin struct {
	Pattern   string     `json:"pattern"`
	Kind      OriginKind `json:"kind"`
	ProjectID string     `json:"-"`
	CreatedAt time.Time  `json:"-"`
}

// OriginField enumerates the fields of Origin which can be used for filtering
// and ordering.
type OriginField uint8

const (
	OriginFieldUnspecified OriginField = iota
	OriginFieldProjectID
	OriginFieldPattern
	OriginFieldKind
	OriginFieldCreatedAt
)

func ErrOriginInvalid() Error {
	return newError(PrefixOrigin.ErrorCodePrefix("invalid"), "origin: must be scheme://host[:port], lowercase, with no path", nil, nil)
}

func ErrOriginPrimaryNotExact() Error {
	return newError(PrefixOrigin.ErrorCodePrefix("primary_not_exact"), "a primary origin is an exact URL, no wildcard", nil, nil)
}

func ErrOriginUnbounded() Error {
	return newError(PrefixOrigin.ErrorCodePrefix("unbounded"), "origin: a wildcard on a shared host needs a literal label of your own beside the host", nil, nil)
}

func ErrOriginKindConflict() Error {
	return newError(PrefixOrigin.ErrorCodePrefix("kind_conflict"), "origin: the pattern is already stored with a different kind", nil, nil)
}

func ErrOriginPermissionDenied() Error {
	return newError(PrefixOrigin.ErrorCodePrefix("permission_denied"), "origin: permission denied", nil, nil)
}

func ErrOriginNotFound() Error {
	return newError(PrefixOrigin.ErrorCodePrefix("not_found"), "origin: not found", nil, nil)
}

// ErrProjectOriginNotAllowed reports a request Origin that matches no origin
// pattern of the project. Callers that include the refused origin in the
// message use WithMessage so the login surface can show it.
func ErrProjectOriginNotAllowed(details any) Error {
	return newError(PrefixProject.ErrorCodePrefix("origin_not_allowed"), "the request origin is not an origin of this project", details, nil)
}

// ErrProjectPreviewNotLive reports an Origin that matches a preview pattern
// but has no live preview row for that exact URL.
func ErrProjectPreviewNotLive(details any) Error {
	return newError(PrefixProject.ErrorCodePrefix("preview_not_live"), "no live preview for this origin; run zitadel preview on this branch", details, nil)
}

// ErrProjectMismatch reports a body project_id that disagrees with the
// project the credential belongs to.
func ErrProjectMismatch() Error {
	return newError(PrefixProject.ErrorCodePrefix("mismatch"), "the project named in the request is not the one the credential belongs to", nil, nil)
}

// NormalizeOrigins returns a non-nil copy with trimmed patterns.
func NormalizeOrigins(origins []Origin) []Origin {
	if origins == nil {
		return []Origin{}
	}
	out := make([]Origin, len(origins))
	for i, o := range origins {
		out[i] = Origin{
			Pattern: strings.TrimSpace(o.Pattern),
			Kind:    o.Kind,
		}
	}
	return out
}

// CompactOrigins keeps the first occurrence of each pattern. Call after
// OriginValidator.ValidateAll so kind conflicts are detected before collapse.
func CompactOrigins(origins []Origin) []Origin {
	if len(origins) == 0 {
		return origins
	}
	seen := make(map[string]struct{}, len(origins))
	out := make([]Origin, 0, len(origins))
	for _, o := range origins {
		pattern := strings.TrimSpace(o.Pattern)
		if _, ok := seen[pattern]; ok {
			continue
		}
		seen[pattern] = struct{}{}
		out = append(out, o)
	}
	return out
}

// NormalizeOrigin lowercases and validates an origin or an origin pattern:
// scheme://host[:port], no path, query, fragment or credentials. A `*` is
// accepted anywhere in the host, which is what makes this usable for
// patterns too; a request origin is matched literally afterwards.
func NormalizeOrigin(raw string) (string, error) {
	origin := strings.ToLower(strings.TrimSpace(raw))
	scheme, host, ok := strings.Cut(origin, "://")
	if !ok || (scheme != "https" && scheme != "http") {
		return "", ErrOriginInvalid()
	}
	if host == "" || strings.ContainsAny(host, "/?#@ \t") {
		return "", ErrOriginInvalid()
	}
	hostname, port := splitHostPort(host)
	if hostname == "" || strings.HasPrefix(hostname, ".") || strings.HasSuffix(hostname, ".") || strings.Contains(hostname, "..") {
		return "", ErrOriginInvalid()
	}
	if port != "" {
		for _, r := range port {
			if r < '0' || r > '9' {
				return "", ErrOriginInvalid()
			}
		}
	}
	return origin, nil
}

func splitHostPort(host string) (hostname, port string) {
	if strings.HasPrefix(host, "[") {
		end := strings.Index(host, "]")
		if end < 0 {
			return host, ""
		}
		rest := host[end+1:]
		if strings.HasPrefix(rest, ":") {
			return host[:end+1], rest[1:]
		}
		return host, ""
	}
	if i := strings.LastIndex(host, ":"); i >= 0 {
		return host[:i], host[i+1:]
	}
	return host, ""
}

// MatchOrigin returns the entry that admits origin. A literal match beats a
// wildcard match, and among wildcards the first in the list wins. Scheme and
// port compare literally; there is no loopback aliasing, because the
// WebAuthn relying-party id derives from the host.
func MatchOrigin(patterns []Origin, origin string) (Origin, bool) {
	origin = strings.ToLower(strings.TrimSpace(origin))
	if origin == "" {
		return Origin{}, false
	}
	var wildcard *Origin
	for i := range patterns {
		entry := patterns[i]
		if !strings.Contains(entry.Pattern, "*") {
			if entry.Pattern == origin {
				return entry, true
			}
			continue
		}
		if wildcard == nil && matchOriginPattern(entry.Pattern, origin) {
			wildcard = &patterns[i]
		}
	}
	if wildcard != nil {
		return *wildcard, true
	}
	return Origin{}, false
}

// matchOriginPattern reports whether a wildcard pattern covers origin. Each
// `*` stands for one or more characters, none of them a dot, so a wildcard
// never crosses a label boundary.
func matchOriginPattern(pattern, origin string) bool {
	return matchStars(pattern, origin)
}

func matchStars(pattern, s string) bool {
	if pattern == "" {
		return s == ""
	}
	if pattern[0] != '*' {
		return s != "" && s[0] == pattern[0] && matchStars(pattern[1:], s[1:])
	}
	for i := 1; i <= len(s); i++ {
		if s[i-1] == '.' {
			return false
		}
		if matchStars(pattern[1:], s[i:]) {
			return true
		}
	}
	return false
}

// IsLoopbackOrigin reports whether origin points at the local machine:
// localhost, a *.localhost name, or a loopback IP literal.
func IsLoopbackOrigin(origin string) bool {
	_, host, ok := strings.Cut(strings.ToLower(origin), "://")
	if !ok {
		return false
	}
	hostname, _ := splitHostPort(host)
	hostname = strings.Trim(hostname, "[]")
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") {
		return true
	}
	if ip := net.ParseIP(hostname); ip != nil {
		return ip.IsLoopback()
	}
	return false
}
