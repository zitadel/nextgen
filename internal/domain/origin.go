package domain

import (
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

// Matches reports whether the pattern admits origin: an exact pattern its
// own URL, a wildcard pattern any URL whose wildcard part is one or more
// characters inside a single host label.
func (o Origin) Matches(origin string) bool {
	if o.Pattern == origin {
		return true
	}
	prefix, suffix, ok := strings.Cut(o.Pattern, "*")
	if !ok || len(origin) <= len(prefix)+len(suffix) ||
		!strings.HasPrefix(origin, prefix) || !strings.HasSuffix(origin, suffix) {
		return false
	}
	return !strings.ContainsAny(origin[len(prefix):len(origin)-len(suffix)], "./:")
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
