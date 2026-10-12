package domain

import (
	"net"
	"net/url"
	"strings"
)

// DefaultSharedHosts is the built-in list of hosts where a preview wildcard
// must keep a literal tenant-unique label. Instance config key
// origins.shared_hosts replaces this list entirely when set (including to
// empty, which disables shared-host unbounded checks).
var DefaultSharedHosts = []string{
	"vercel.app",
	"netlify.app",
	"pages.dev",
	"workers.dev",
}

// OriginValidator checks write rules for create and add. SharedHosts is the
// effective list after config replace-defaults; a nil or empty list skips
// unbounded checks.
type OriginValidator struct {
	SharedHosts []string
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
	for _, label := range strings.Split(host, ".") {
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
	prefix := strings.TrimSuffix(host, "."+shared)
	if prefix == host {
		// host == shared (e.g. pattern host "vercel.app") — wildcard can't appear.
		return false
	}
	switch shared {
	case "vercel.app":
		// https://*-team.vercel.app — one label, * plus a non-empty literal.
		return !vercelTenantLabel(prefix)
	case "netlify.app":
		// https://*--site.netlify.app — one label starting with *-- and a site name.
		return !netlifyTenantLabel(prefix)
	case "pages.dev", "workers.dev":
		// https://*.project.pages.dev / https://*.account.workers.dev
		return !dottedTenantLabel(prefix)
	default:
		// Unknown shared host from config: require a literal label beside *.
		return !hasLiteralBesideWildcard(prefix)
	}
}

func matchSharedHost(host string, sharedHosts []string) string {
	best := ""
	for _, shared := range sharedHosts {
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

func vercelTenantLabel(prefix string) bool {
	if strings.Contains(prefix, ".") {
		return false
	}
	if !strings.HasPrefix(prefix, "*") || prefix == "*" {
		return false
	}
	// Remainder after * must be non-empty and contain no *.
	rest := strings.TrimPrefix(prefix, "*")
	return rest != "" && !strings.Contains(rest, "*")
}

func netlifyTenantLabel(prefix string) bool {
	if strings.Contains(prefix, ".") {
		return false
	}
	if !strings.HasPrefix(prefix, "*--") {
		return false
	}
	rest := strings.TrimPrefix(prefix, "*--")
	return rest != "" && !strings.Contains(rest, "*")
}

func dottedTenantLabel(prefix string) bool {
	labels := strings.Split(prefix, ".")
	if len(labels) != 2 {
		return false
	}
	return labels[0] == "*" && labels[1] != "" && !strings.Contains(labels[1], "*")
}

func hasLiteralBesideWildcard(prefix string) bool {
	if !strings.Contains(prefix, "*") {
		return true
	}
	for _, label := range strings.Split(prefix, ".") {
		if label == "" || label == "*" {
			continue
		}
		if strings.Contains(label, "*") {
			rest := strings.ReplaceAll(label, "*", "")
			if rest != "" {
				return true
			}
			continue
		}
		return true
	}
	return false
}
