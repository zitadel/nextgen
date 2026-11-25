package domain

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
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

// CompileSharedHosts compiles a host→pattern map. Bad patterns return a
// descriptive error suitable for config load.
func CompileSharedHosts(patterns map[string]string) (map[string]*regexp.Regexp, error) {
	out := make(map[string]*regexp.Regexp, len(patterns))
	for host, pattern := range patterns {
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, fmt.Errorf("%q: %w", host, err)
		}
		out[host] = re
	}
	return out, nil
}

func mustCompileSharedHosts(patterns map[string]string) map[string]*regexp.Regexp {
	out, err := CompileSharedHosts(patterns)
	if err != nil {
		panic(err)
	}
	return out
}

// OriginValidator checks write rules for create and add. SharedHosts is the
// effective host→allow-regexp map after config replace-defaults; a nil or
// empty map skips unbounded checks.
type OriginValidator struct {
	SharedHosts map[string]*regexp.Regexp
}

// ValidateAll validates every origin; the first failure wins. Same pattern /
// different kind → kind_conflict. Same pattern / same kind is idempotent
// (matches AddOrigin); callers should CompactOrigins after ValidateAll.
func (v OriginValidator) ValidateAll(origins []Origin) error {
	seen := make(map[string]OriginKind, len(origins))
	for _, o := range origins {
		if err := v.Validate(o); err != nil {
			return err
		}
		pattern := strings.TrimSpace(o.Pattern)
		if prev, ok := seen[pattern]; ok {
			if prev != o.Kind {
				return ErrOriginKindConflict()
			}
			continue
		}
		seen[pattern] = o.Kind
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
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return ErrOriginInvalid()
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
		return nil
	}

	if o.Kind != OriginKindPrimary && o.Kind != OriginKindPreview {
		return ErrOriginInvalid()
	}
	return nil
}
