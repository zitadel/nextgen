package domain

import (
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DeploymentTargetPrimary is the targets keyword for every primary origin of
// the project.
const DeploymentTargetPrimary = "primary"

// DefaultPreviewTTL is how long a preview stays live when a deploy gives no
// ttl.
const DefaultPreviewTTL = 7 * 24 * time.Hour

// ParsePreviewTTL parses a ttl such as 30m, 168h or 7d.
func ParsePreviewTTL(ttl string) (time.Duration, error) {
	invalid := ErrDeploymentInvalid("ttl must be a positive whole number followed by m, h or d", nil)
	if len(ttl) < 2 {
		return 0, invalid
	}
	n, err := strconv.ParseUint(ttl[:len(ttl)-1], 10, 32)
	if err != nil || n == 0 {
		return 0, invalid
	}
	unit := map[byte]time.Duration{'m': time.Minute, 'h': time.Hour, 'd': 24 * time.Hour}[ttl[len(ttl)-1]]
	if unit == 0 {
		return 0, invalid
	}
	return time.Duration(n) * unit, nil
}

// Matches reports whether origin is admitted by the pattern. A wildcard
// stands for one or more characters within a single host label.
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

// ResolveDeploymentTargets expands targets against the project's origins:
// the primary keyword to every primary origin, an exact origin to a primary
// origin or a URL a preview pattern admits. Kinds never mix.
func ResolveDeploymentTargets(origins []Origin, targets []string) (DeploymentOriginKind, []string, error) {
	var primary []string
	for _, o := range origins {
		if o.Kind == OriginKindPrimary {
			primary = append(primary, o.Pattern)
		}
	}

	var resolved []string
	kinds := map[DeploymentOriginKind]bool{}
	for _, target := range targets {
		if target == DeploymentTargetPrimary {
			if len(primary) == 0 {
				return 0, nil, ErrDeploymentInvalid("the project has no primary origin", nil)
			}
			kinds[DeploymentOriginKindPrimary] = true
			resolved = append(resolved, primary...)
			continue
		}
		kind, ok := originKind(origins, target)
		if !ok {
			return 0, nil, ErrProjectOriginNotAllowed(target)
		}
		kinds[kind] = true
		resolved = append(resolved, target)
	}
	if len(kinds) > 1 {
		return 0, nil, ErrDeploymentInvalid("primary origins and preview URLs cannot be mixed", nil)
	}
	if kinds[DeploymentOriginKindPreview] {
		return DeploymentOriginKindPreview, resolved, nil
	}
	return DeploymentOriginKindPrimary, resolved, nil
}

// originKind classifies an exact origin: a primary origin first, then a URL
// a preview pattern admits. A preview URL is never a loopback origin.
func originKind(origins []Origin, origin string) (DeploymentOriginKind, bool) {
	for _, o := range origins {
		if o.Kind == OriginKindPrimary && o.Pattern == origin {
			return DeploymentOriginKindPrimary, true
		}
	}
	if isLoopbackOrigin(origin) {
		return 0, false
	}
	for _, o := range origins {
		if o.Kind == OriginKindPreview && o.Matches(origin) {
			return DeploymentOriginKindPreview, true
		}
	}
	return 0, false
}

func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}
