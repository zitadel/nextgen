package domain

import (
	"regexp"
	"strings"
	"time"
)

const (
	PrefixEnvironment ResourcePrefix = "env"
)

const (
	EnvironmentNameMaxLength = 63
	EnvironmentNamePattern   = `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`

	// LiveEnvironmentName is the one environment every project has: the
	// configuration the project serves by default. Every other environment
	// is a preview that shares the project's data and expires on its own.
	LiveEnvironmentName = "live"

	// EnvironmentMaxOrigins bounds the origins a preview environment may
	// claim, so a request's Origin can be matched by a linear scan.
	EnvironmentMaxOrigins = 16
)

var environmentNameRegex = regexp.MustCompile(EnvironmentNamePattern)

// DefaultEnvironmentNames are the environments seeded with every project.
// Only live: previews are created on demand by `zitadel preview`.
var DefaultEnvironmentNames = []string{LiveEnvironmentName}

// EnvironmentClass says what kind of runtime slot an environment is. Live is
// the project's default configuration; preview is an ephemeral slot for
// trying a release against the project's real data before it goes live.
//
//go:generate go tool enumer -type EnvironmentClass -transform snake -trimprefix EnvironmentClass -sql
type EnvironmentClass uint8

const (
	EnvironmentClassLive EnvironmentClass = iota
	EnvironmentClassPreview
)

func ErrEnvironmentNameInvalid() Error {
	return newError(
		PrefixEnvironment.ErrorCodePrefix("name_invalid"),
		"The environment name is invalid. Expected 1-63 characters of lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
		nil, nil,
	)
}

func ErrEnvironmentInvalid(details any) Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("invalid"), "environment: invalid", details, nil)
}

func ErrEnvironmentNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("not_found"), "environment not found", nil, nil)
}

// ErrEnvironmentExpired reports a preview environment whose expires_at has
// passed. It still exists until garbage collection removes it, but nothing
// resolves to it any more.
func ErrEnvironmentExpired() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("expired"), "the preview environment has expired", nil, nil)
}

// EnvironmentAmbiguousDetails names the previews that all claim a request's
// origin, and the release selector (if any) that failed to single one out.
type EnvironmentAmbiguousDetails struct {
	Candidates []string `json:"candidates"`
	ReleaseID  string   `json:"release_id,omitempty"`
}

// ErrEnvironmentAmbiguous reports a request origin covered by several preview
// environments whose release selector picks none or several of them. The
// frontend deployment fixes it by naming its preview (X-Zitadel-Environment)
// or the release it was built against (X-Zitadel-Release).
func ErrEnvironmentAmbiguous(details EnvironmentAmbiguousDetails) Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("ambiguous"), "several preview environments serve this origin; send X-Zitadel-Environment with the preview the deployment was built for, or X-Zitadel-Release with its release", details, nil)
}

// ErrEnvironmentReleaseRequired reports a request that reached a preview
// through a wildcard origin without naming the preview or the release it
// was built against. Such deployments always say which (X-Zitadel-Environment
// or X-Zitadel-Release), so which previews happen to exist never changes
// what one of them gets.
func ErrEnvironmentReleaseRequired(details EnvironmentAmbiguousDetails) Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("release_required"), "this origin is served by a preview environment; send X-Zitadel-Environment with the preview the deployment was built for, or X-Zitadel-Release with its release", details, nil)
}

// EnvironmentOriginNotServedDetails names the environment a request asked
// for and the origin it came from, with the origins the environment serves.
type EnvironmentOriginNotServedDetails struct {
	Environment string   `json:"environment"`
	Origin      string   `json:"origin"`
	Origins     []string `json:"origins"`
}

// ErrEnvironmentOriginNotServed reports a request that named an environment
// (X-Zitadel-Environment) from an origin that environment does not serve.
// Naming a preview never widens where it can be reached from: a production
// deployment cannot be pointed at a preview, and a preview deployment only
// reaches the preview whose origins cover it.
func ErrEnvironmentOriginNotServed(details EnvironmentOriginNotServedDetails) Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("origin_not_served"), "The environment does not serve the request origin. Register the origin on the environment (zitadel preview --origin, or the entry's issuer_pattern in zitadel.json) and deploy again.", details, nil)
}

func ErrEnvironmentProjectNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("project_not_found"), "project not found", nil, nil)
}

func ErrEnvironmentPermissionDenied() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("permission_denied"), "the environment management API requires the project secret", nil, nil)
}

type Environment struct {
	ProjectID string
	ID        string
	Name      string
	Class     EnvironmentClass
	// ExpiresAt is set on preview environments only. Renewed on every
	// deploy to the environment; nil means the environment never expires.
	ExpiresAt *time.Time
	// Origins are the request origins that resolve to this environment.
	// A request whose Origin matches none of any preview's origins is served
	// by live, so live itself carries no origins.
	Origins   []string
	CreatedAt time.Time
	// CurrentDeploymentID points at the deployment this environment runs,
	// nil until something is deployed. Written only by CreateDeployment, in
	// the same transaction as the deployment row it points at.
	CurrentDeploymentID *string
}

// NewEnvironment builds a live-class environment.
func NewEnvironment(projectID, name string) (*Environment, error) {
	name, err := ValidateEnvironmentName(name)
	if err != nil {
		return nil, err
	}
	return &Environment{
		ProjectID: projectID,
		Name:      name,
		Class:     EnvironmentClassLive,
	}, nil
}

// NewPreviewEnvironment builds a preview-class environment that expires at
// expiresAt and serves requests arriving from origins.
func NewPreviewEnvironment(projectID, name string, expiresAt time.Time, origins []string) (*Environment, error) {
	name, err := ValidateEnvironmentName(name)
	if err != nil {
		return nil, err
	}
	if name == LiveEnvironmentName {
		return nil, ErrEnvironmentInvalid("the live environment cannot be a preview")
	}
	if expiresAt.IsZero() {
		return nil, ErrEnvironmentInvalid("a preview environment needs expires_at")
	}
	normalized, err := ValidateEnvironmentOrigins(origins)
	if err != nil {
		return nil, err
	}
	return &Environment{
		ProjectID: projectID,
		Name:      name,
		Class:     EnvironmentClassPreview,
		ExpiresAt: &expiresAt,
		Origins:   normalized,
	}, nil
}

// Expired reports whether a preview environment's expires_at has passed.
// Live never expires.
func (e *Environment) Expired(now time.Time) bool {
	return e.ExpiresAt != nil && !now.Before(*e.ExpiresAt)
}

// ServesOrigin reports whether origin is covered by one of the environment's
// origins, which may be wildcard patterns (see MatchOrigin).
func (e *Environment) ServesOrigin(origin string) bool {
	return MatchAnyOrigin(e.Origins, origin)
}

// ValidateEnvironmentName returns the trimmed name, or
// ErrEnvironmentNameInvalid.
func ValidateEnvironmentName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if len(name) > EnvironmentNameMaxLength || !environmentNameRegex.MatchString(name) {
		return "", ErrEnvironmentNameInvalid()
	}
	return name, nil
}

// ValidateEnvironmentOrigins normalises and deduplicates origins, each a
// bare origin or a leftmost-label wildcard pattern (NormalizeOriginPattern).
func ValidateEnvironmentOrigins(origins []string) ([]string, error) {
	if len(origins) > EnvironmentMaxOrigins {
		return nil, ErrEnvironmentInvalid("too many origins")
	}
	out := make([]string, 0, len(origins))
	seen := make(map[string]bool, len(origins))
	for _, raw := range origins {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		origin, err := NormalizeOriginPattern(raw)
		if err != nil {
			return nil, ErrEnvironmentInvalid(err.Error())
		}
		if seen[origin] {
			continue
		}
		seen[origin] = true
		out = append(out, origin)
	}
	return out, nil
}

type EnvironmentField uint8

const (
	EnvironmentFieldUnspecified EnvironmentField = iota
	EnvironmentFieldProjectID
	EnvironmentFieldID
	EnvironmentFieldName
	EnvironmentFieldClass
	EnvironmentFieldExpiresAt
	EnvironmentFieldCreatedAt
	EnvironmentFieldCurrentDeploymentID
)
