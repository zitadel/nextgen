package domain

import (
	"strings"
)

// Origin patterns.
//
// An origin allowlist entry is a bare origin (`https://app.example.com`,
// `http://localhost:3000`) or a pattern whose leftmost host label is `*`
// (`https://*.vercel.app`, `https://*.preview.example.com`). The wildcard
// matches exactly one label, so `https://*.vercel.app` covers every Vercel
// preview deployment (`my-app-git-feat-sso-acme.vercel.app`) without
// covering `vercel.app` itself or a deeper subdomain. Scheme and port must
// match literally; hosts compare case-insensitively.

// NormalizeOriginPattern lowercases and validates an origin or origin
// pattern. It rejects anything with a path, query or fragment, and a
// wildcard anywhere but as the whole leftmost host label.
func NormalizeOriginPattern(raw string) (string, error) {
	pattern := strings.ToLower(strings.TrimSpace(raw))
	var host string
	switch {
	case strings.HasPrefix(pattern, "https://"):
		host = strings.TrimPrefix(pattern, "https://")
	case strings.HasPrefix(pattern, "http://"):
		host = strings.TrimPrefix(pattern, "http://")
	default:
		return "", ErrOriginPatternInvalid("origin must start with http:// or https://: " + raw)
	}
	if host == "" || strings.ContainsAny(host, "/?#@ ") {
		return "", ErrOriginPatternInvalid("origin must be scheme://host[:port]: " + raw)
	}
	if star := strings.Index(host, "*"); star >= 0 {
		if star != 0 || !strings.HasPrefix(host, "*.") || strings.Count(host, "*") != 1 {
			return "", ErrOriginPatternInvalid("a wildcard must be the whole leftmost host label, like https://*.vercel.app: " + raw)
		}
		rest := strings.TrimPrefix(host, "*.")
		if rest == "" || strings.HasPrefix(rest, ".") || strings.HasPrefix(rest, ":") {
			return "", ErrOriginPatternInvalid("a wildcard needs a domain after it: " + raw)
		}
	}
	return pattern, nil
}

// MatchOrigin reports whether origin is covered by pattern, which is either
// a bare origin (exact, case-insensitive match) or a leftmost-label wildcard
// as described above. Matching is deliberately literal on scheme and port —
// no loopback aliasing between localhost, 127.0.0.1 and [::1] — because the
// WebAuthn relying-party id derives from the origin host.
func MatchOrigin(pattern, origin string) bool {
	pattern = strings.ToLower(strings.TrimSpace(pattern))
	origin = strings.ToLower(strings.TrimSpace(origin))
	if pattern == "" || origin == "" {
		return false
	}
	if !strings.Contains(pattern, "*") {
		return pattern == origin
	}
	scheme, patternHost, ok := strings.Cut(pattern, "://")
	if !ok || !strings.HasPrefix(patternHost, "*.") {
		return false
	}
	originScheme, originHost, ok := strings.Cut(origin, "://")
	if !ok || originScheme != scheme {
		return false
	}
	suffix := strings.TrimPrefix(patternHost, "*") // ".vercel.app" or ".vercel.app:443"
	if !strings.HasSuffix(originHost, suffix) {
		return false
	}
	label := strings.TrimSuffix(originHost, suffix)
	return label != "" && !strings.ContainsAny(label, ".:/")
}

// MatchAnyOrigin reports whether any pattern covers origin.
func MatchAnyOrigin(patterns []string, origin string) bool {
	for _, pattern := range patterns {
		if MatchOrigin(pattern, origin) {
			return true
		}
	}
	return false
}

func ErrOriginPatternInvalid(details any) Error {
	return newError("origin.invalid", "origin: invalid", details, nil)
}
