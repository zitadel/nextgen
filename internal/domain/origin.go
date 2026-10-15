package domain

import (
	"net/url"
	"strconv"
	"strings"
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
	Pattern string     `json:"pattern"`
	Kind    OriginKind `json:"kind"`
}

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

// ValidateOriginsWriteRules applies the structural write rules for create:
// primary must be exact, kinds must be primary|preview, and one kind per
// pattern. The same pattern with the same kind is idempotent (like AddOrigin);
// the same pattern with a different kind is origin.kind_conflict.
func ValidateOriginsWriteRules(origins []Origin) error {
	seen := make(map[string]OriginKind, len(origins))
	for _, o := range origins {
		if err := validateOriginWriteRule(o); err != nil {
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

// CompactOrigins keeps the first occurrence of each pattern. Call after
// ValidateOriginsWriteRules so kind conflicts are detected before collapse.
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

func validateOriginWriteRule(o Origin) error {
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
	if u.Opaque != "" || u.User != nil || u.Path != "" && u.Path != "/" || u.RawPath != "" ||
		u.RawQuery != "" || u.Fragment != "" {
		return ErrOriginInvalid()
	}
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
