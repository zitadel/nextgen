package domain

import (
	"net"
	"strings"
	"time"
)

// OriginKind says what an origin pattern is for. A primary pattern admits
// requests from the URLs it matches; a preview pattern only bounds which URLs
// a preview deploy may register, and a request from such a URL is admitted by
// its [Preview] row alone.
//
//go:generate go tool enumer -type OriginKind -transform snake -trimprefix OriginKind -sql
type OriginKind uint8

const (
	OriginKindPrimary OriginKind = iota
	OriginKindPreview
)

// ProjectMode is what a project is for. A sandbox allows loopback origins,
// no origins meaning allow-all, and any release named in a header; a
// production project requires at least one pattern, refuses loopback and
// wildcard primaries, and only serves a pinned release already deployed to
// the matched target.
//
//go:generate go tool enumer -type ProjectMode -transform snake -trimprefix ProjectMode -sql
type ProjectMode uint8

const (
	ProjectModeSandbox ProjectMode = iota
	ProjectModeProduction
)

// Origin is one entry of a project's origins: a pattern and what it is for.
// Pattern is normalised (lowercase scheme://host[:port]) and may hold one or
// more `*`, each matching one or more characters none of which is a dot.
type Origin struct {
	Pattern string
	Kind    OriginKind
}

// Preview is a live preview URL. The row is what admits requests from the
// URL until ExpiresAt; a URL matching a preview pattern but holding no row
// is refused. Renewed by deploying to it again, retired by deleting it.
type Preview struct {
	ProjectID string
	Origin    string
	ExpiresAt time.Time
	CreatedAt time.Time
}

func (p *Preview) Expired(now time.Time) bool {
	return !p.ExpiresAt.After(now)
}

// OriginLintWarning is a non-fatal finding on a pattern: accepted, with a
// note the caller shows.
type OriginLintWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func ErrOriginInvalid(details any) Error {
	return newError("origin.invalid", "origin: must be scheme://host[:port], lowercase, with no path", details, nil)
}

func ErrOriginNotFound() Error {
	return newError("origin.not_found", "origin: no such pattern on this project", nil, nil)
}

func ErrPreviewNotFound() Error {
	return newError("preview.not_found", "preview: no live preview for this URL", nil, nil)
}

func ErrOriginNotPermittedForMode(details any) Error {
	return newError("origin.not_permitted_for_mode", "origin: the pattern is not permitted on a project in this mode", details, nil)
}

func ErrOriginUnbounded(details any) Error {
	return newError("origin.unbounded", "origin: a wildcard on a shared host needs a literal label of your own beside the host", details, nil)
}

func ErrOriginPermissionDenied() Error {
	return newError("origin.permission_denied", "origin: permission denied", nil, nil)
}

func ErrProjectOriginNotAllowed(details any) Error {
	return newError(PrefixProject.ErrorCodePrefix("origin_not_allowed"), "the request origin matches no allowed origin of this project", details, nil)
}

func ErrProjectPreviewNotLive(details any) Error {
	return newError(PrefixProject.ErrorCodePrefix("preview_not_live"), "this preview is no longer live; push again or run zitadel preview", details, nil)
}

func ErrProjectMismatch() Error {
	return newError(PrefixProject.ErrorCodePrefix("mismatch"), "the project named in the request is not the one the credential belongs to", nil, nil)
}

func ErrProjectModeChangeRefused(details any) Error {
	return newError(PrefixProject.ErrorCodePrefix("mode_change_refused"), "the project cannot change mode until every origin passes the rules of the new mode", details, nil)
}

// NormalizeOrigin lowercases and validates an origin or an origin pattern:
// scheme://host[:port], no path, query, fragment or credentials. A `*` is
// accepted anywhere in the host, which is what makes this usable for
// patterns too; a request origin is matched literally afterwards.
func NormalizeOrigin(raw string) (string, error) {
	origin := strings.ToLower(strings.TrimSpace(raw))
	scheme, host, ok := strings.Cut(origin, "://")
	if !ok || (scheme != "https" && scheme != "http") {
		return "", ErrOriginInvalid(map[string]string{"origin": raw, "reason": "must start with http:// or https://"})
	}
	if host == "" || strings.ContainsAny(host, "/?#@ \t") {
		return "", ErrOriginInvalid(map[string]string{"origin": raw, "reason": "must be scheme://host[:port]"})
	}
	hostname, port := splitHostPort(host)
	if hostname == "" || strings.HasPrefix(hostname, ".") || strings.HasSuffix(hostname, ".") || strings.Contains(hostname, "..") {
		return "", ErrOriginInvalid(map[string]string{"origin": raw, "reason": "the host is malformed"})
	}
	if port != "" {
		for _, r := range port {
			if r < '0' || r > '9' {
				return "", ErrOriginInvalid(map[string]string{"origin": raw, "reason": "the port is not a number"})
			}
		}
	}
	return origin, nil
}

// splitHostPort separates a trailing :port from a host, leaving a bracketed
// IPv6 literal whole.
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
	// The star must take at least one character and may not take a dot.
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

// sharedHost describes a host anyone can mint hostnames under, and the shape
// a tenant-unique label takes there. Consulted only when a pattern is saved.
type sharedHost struct {
	// suffix is the domain every preview hostname ends with, dot included.
	suffix string
	// labelBounded reports whether the hostname left of suffix carries a
	// literal label beside the wildcard — the part only the tenant owns.
	labelBounded func(left string) bool
}

var sharedHosts = []sharedHost{
	// <project>-git-<branch>-<team>.vercel.app: the team slug ends the label.
	{suffix: ".vercel.app", labelBounded: func(left string) bool {
		return strings.HasPrefix(left, "*-") && len(strings.TrimPrefix(left, "*-")) > 0 && !strings.Contains(strings.TrimPrefix(left, "*-"), "*")
	}},
	// deploy-preview-<n>--<site>.netlify.app: the site name ends the label.
	{suffix: ".netlify.app", labelBounded: func(left string) bool {
		return strings.HasPrefix(left, "*--") && len(strings.TrimPrefix(left, "*--")) > 0 && !strings.Contains(strings.TrimPrefix(left, "*--"), "*")
	}},
	// <hash>.<project>.pages.dev: the project is its own label.
	{suffix: ".pages.dev", labelBounded: dottedLabel},
	// <version>-<worker>.<account>.workers.dev: the account is its own label.
	{suffix: ".workers.dev", labelBounded: dottedLabel},
}

// dottedLabel accepts `*.<label>` where the label holds no wildcard: a dotted
// label cannot be imitated from the left.
func dottedLabel(left string) bool {
	rest, ok := strings.CutPrefix(left, "*.")
	return ok && rest != "" && !strings.Contains(rest, "*")
}

// LintOriginPattern checks one entry against a project mode. It returns an
// error for a pattern the mode refuses and a warning for one it accepts
// without being able to check. The same rules run when a project changes
// mode, against every pattern it holds.
func LintOriginPattern(mode ProjectMode, entry Origin) (*OriginLintWarning, error) {
	if _, err := NormalizeOrigin(entry.Pattern); err != nil {
		return nil, err
	}
	hasStar := strings.Contains(entry.Pattern, "*")
	details := map[string]string{"pattern": entry.Pattern, "kind": entry.Kind.String()}

	if mode == ProjectModeProduction {
		if IsLoopbackOrigin(entry.Pattern) {
			details["reason"] = "loopback origins are only allowed on a sandbox project"
			return nil, ErrOriginNotPermittedForMode(details)
		}
		if entry.Kind == OriginKindPrimary && hasStar {
			details["reason"] = "a primary pattern on a production project must be an exact origin"
			return nil, ErrOriginNotPermittedForMode(details)
		}
	}
	if !hasStar {
		return nil, nil
	}

	_, host, _ := strings.Cut(entry.Pattern, "://")
	hostname, _ := splitHostPort(host)
	for _, shared := range sharedHosts {
		left, ok := strings.CutSuffix(hostname, shared.suffix)
		if !ok {
			continue
		}
		if shared.labelBounded(left) {
			return nil, nil
		}
		if mode == ProjectModeProduction {
			details["host"] = strings.TrimPrefix(shared.suffix, ".")
			return nil, ErrOriginUnbounded(details)
		}
		return &OriginLintWarning{
			Code:    "origin_unbounded",
			Message: "the pattern carries no literal label of your own on " + strings.TrimPrefix(shared.suffix, ".") + "; a production project will refuse it",
		}, nil
	}
	return &OriginLintWarning{
		Code:    "origin_host_unknown",
		Message: hostname + " is not a host the server knows; the label could not be checked",
	}, nil
}
