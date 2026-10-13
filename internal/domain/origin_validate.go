package domain

import (
	"net"
	"net/url"
	"regexp"
	"strings"
)

// DefaultSharedHostPatterns is the built-in host→allow-regexp string map.
// Instance config key origins.shared_hosts replaces this map entirely when set
// (including to empty, which disables shared-host unbounded checks). Each
// regexp must match the full hostname of a wildcard preview pattern.
var DefaultSharedHostPatterns = map[string]string{
	"vercel.app":  `^\*[^*]+\.vercel\.app$`,
	"netlify.app": `^\*--[^*]+\.netlify\.app$`,
	"pages.dev":   `^\*\.[^*]+\.pages\.dev$`,
	"workers.dev": `^\*\.[^*]+\.workers\.dev$`,
}

// DefaultSharedHosts is DefaultSharedHostPatterns compiled for tests and for
// the nil-config default applied after config load.
var DefaultSharedHosts = mustCompileSharedHosts(DefaultSharedHostPatterns)

func mustCompileSharedHosts(patterns map[string]string) map[string]*regexp.Regexp {
	out := make(map[string]*regexp.Regexp, len(patterns))
	for host, pattern := range patterns {
		out[host] = regexp.MustCompile(pattern)
	}
	return out
}

// OriginValidator checks write rules for create and add. SharedHosts is the
// effective host→allow-regexp map after config replace-defaults; a nil or
// empty map skips unbounded checks.
type OriginValidator struct {
	SharedHosts map[string]*regexp.Regexp
}

// ValidateAll validates every origin; the first failure wins.
func (v OriginValidator) ValidateAll(origins []Origin) error {
	for _, o := range origins {
		if err := v.Validate(o); err != nil {
			return err
		}
	}
	return nil
}

// Validate applies the locked write rules for one origin pattern.
func (v OriginValidator) Validate(o Origin) error {
	pattern := strings.TrimSpace(o.Pattern)
	if pattern == "" || pattern != strings.ToLower(pattern) {
		return ErrOriginInvalid()
	}
	u, err := url.Parse(pattern)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ErrOriginInvalid()
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrOriginInvalid()
	}
	// Reject anything beyond scheme + host[:port]: path, query, fragment, userinfo.
	if u.Opaque != "" || u.User != nil || u.Path != "" && u.Path != "/" || u.RawPath != "" ||
		u.RawQuery != "" || u.Fragment != "" {
		return ErrOriginInvalid()
	}
	// url.Parse keeps "/" as Path for "https://host/" — treat trailing slash as invalid.
	if strings.HasSuffix(pattern, "/") {
		return ErrOriginInvalid()
	}

	host := u.Hostname()
	if host == "" {
		return ErrOriginInvalid()
	}
	if port := u.Port(); port != "" {
		if _, err := net.LookupPort("tcp", port); err != nil {
			// LookupPort rejects non-numeric; also allow numeric ports without service name.
			if _, convErr := parsePortNumber(port); convErr != nil {
				return ErrOriginInvalid()
			}
		}
	}

	starCount := strings.Count(host, "*")
	if starCount > 1 {
		return ErrOriginInvalid()
	}
	if starCount == 1 {
		if o.Kind == OriginKindPrimary {
			return ErrOriginPrimaryNotExact()
		}
		if o.Kind != OriginKindPreview {
			return ErrOriginInvalid()
		}
		if !wildcardInOwnLabel(host) {
			return ErrOriginInvalid()
		}
		if v.isUnboundedSharedHost(host) {
			return ErrOriginUnbounded()
		}
		return nil
	}

	if o.Kind != OriginKindPrimary && o.Kind != OriginKindPreview {
		return ErrOriginInvalid()
	}
	return nil
}

func parsePortNumber(port string) (int, error) {
	n := 0
	for _, c := range port {
		if c < '0' || c > '9' {
			return 0, ErrOriginInvalid()
		}
		n = n*10 + int(c-'0')
		if n > 65535 {
			return 0, ErrOriginInvalid()
		}
	}
	if n == 0 {
		return 0, ErrOriginInvalid()
	}
	return n, nil
}

// wildcardInOwnLabel reports whether the single * sits inside one DNS label
// (not across dots) so it can stand for one or more non-dot characters.
func wildcardInOwnLabel(host string) bool {
	for label := range strings.SplitSeq(host, ".") {
		if strings.Count(label, "*") == 1 {
			return true
		}
		if strings.Contains(label, "*") {
			return false
		}
	}
	return false
}

func (v OriginValidator) isUnboundedSharedHost(host string) bool {
	shared := matchSharedHost(host, v.SharedHosts)
	if shared == "" {
		return false
	}
	allow := v.SharedHosts[shared]
	if allow == nil {
		return false
	}
	// Regexp matches the full hostname; no match means unbounded on that host.
	return !allow.MatchString(host)
}

func matchSharedHost(host string, sharedHosts map[string]*regexp.Regexp) string {
	best := ""
	for shared := range sharedHosts {
		shared = strings.ToLower(strings.TrimSpace(shared))
		if shared == "" {
			continue
		}
		if host == shared || strings.HasSuffix(host, "."+shared) {
			if len(shared) > len(best) {
				best = shared
			}
		}
	}
	return best
}
