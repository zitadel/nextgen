package domain

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

const (
	PrefixDeployment ResourcePrefix = "dep"
)

// MaxDeploymentTargets caps the origins one deployment covers.
const MaxDeploymentTargets = 50

// DefaultPreviewTTL is how long a preview stays live after the deployment
// that writes it, when the deployment gives no ttl.
const DefaultPreviewTTL = 7 * 24 * time.Hour

// MaxPreviewTTL caps the ttl a deployment may give.
const MaxPreviewTTL = 365 * 24 * time.Hour

// ResolvePreviewTTL picks the lifetime a preview deploy renews.
// When requested is nil, DefaultPreviewTTL is used. Otherwise requested
// must be positive and at most MaxPreviewTTL.
func ResolvePreviewTTL(requested *time.Duration) (time.Duration, error) {
	if requested == nil {
		return DefaultPreviewTTL, nil
	}
	if *requested <= 0 || *requested > MaxPreviewTTL {
		return 0, ErrDeploymentInvalid().WithMessage(fmt.Sprintf(
			"ttl must be positive and at most %d days", MaxPreviewTTL/(24*time.Hour)))
	}
	return *requested, nil
}

// DeploymentReason records why a deployment was created.
//
//go:generate go tool enumer -type DeploymentReason -transform snake -trimprefix DeploymentReason -sql -json
type DeploymentReason uint8

const (
	DeploymentReasonDeploy DeploymentReason = iota
	DeploymentReasonRollback
)

// DeploymentOriginKind says whether a deployment goes to primary origins or to
// preview URLs. One deployment never mixes them.
//
//go:generate go tool enumer -type DeploymentOriginKind -transform snake -trimprefix DeploymentOriginKind -sql
type DeploymentOriginKind uint8

const (
	DeploymentOriginKindPrimary DeploymentOriginKind = iota
	DeploymentOriginKindPreview
)

// ErrDeploymentInvalid refuses a deployment; WithMessage says why.
func ErrDeploymentInvalid() Error {
	return newError(PrefixDeployment.ErrorCodePrefix("invalid"), "deployment: invalid", nil, nil)
}

func ErrDeploymentNotFound() Error {
	return newError(PrefixDeployment.ErrorCodePrefix("not_found"), "deployment: not found", nil, nil)
}

func ErrDeploymentPermissionDenied() Error {
	return newError(PrefixDeployment.ErrorCodePrefix("permission_denied"), "deployment: requires an operator-grade token bound to the project (project.write or a deployment.* scope)", nil, nil)
}

// DeploymentConflictDetails carries the newest deployment to the origins, nil
// when nothing was deployed there.
type DeploymentConflictDetails struct {
	Deployment *Deployment `json:"deployment"`
}

// ErrDeploymentConflict reports a failed expected_deployment_id check.
func ErrDeploymentConflict(details DeploymentConflictDetails) Error {
	return newError(PrefixDeployment.ErrorCodePrefix("conflict"), "deployment: the deployment it replaces does not match expected_deployment_id", details, nil)
}

// DeploymentVariablesMissingDetails names the kind whose values the deployment
// would freeze and every referenced name that kind does not hold.
type DeploymentVariablesMissingDetails struct {
	Kind  string   `json:"kind"`
	Names []string `json:"names"`
}

// ErrDeploymentVariablesMissing refuses a deploy whose release references
// names the frozen set lacks. names is sorted so the wire order is stable.
func ErrDeploymentVariablesMissing(kind DeploymentOriginKind, names []string) Error {
	sorted := slices.Clone(names)
	slices.Sort(sorted)
	return newError(
		PrefixDeployment.ErrorCodePrefix("variables_missing"),
		"deployment: the release references variables its kind has no value for",
		DeploymentVariablesMissingDetails{Kind: kind.String(), Names: sorted},
		nil,
	)
}

// DeploymentMetadata records why the release went live and who did it. A
// caller without a user identity leaves DeployedBy and DeployedByType nil.
type DeploymentMetadata struct {
	Reason  DeploymentReason `json:"reason"`
	Message *string          `json:"message"`
	// RollbackTo names the deployment a rollback re-applied.
	RollbackTo     *string         `json:"rollback_to"`
	DeployedBy     *string         `json:"deployed_by"`
	DeployedByType *EventActorType `json:"deployed_by_type"`
}

// DeploymentTarget is one origin a deployment covered.
type DeploymentTarget struct {
	Origin string `json:"origin"`
}

// Deployment is an append-only record of a release going live on a set of
// origins, sorted. All primary origins serve the newest primary deployment; a
// preview URL serves its latest deployment until the preview expires.
type Deployment struct {
	ProjectID  string               `json:"project_id"`
	ID         string               `json:"id"`
	ReleaseID  string               `json:"release_id"`
	OriginKind DeploymentOriginKind `json:"-"`
	Targets    []DeploymentTarget   `json:"targets"`
	Metadata   DeploymentMetadata   `json:"metadata"`
	DeployedAt time.Time            `json:"deployed_at"`
}

// Origins returns the deployment's origins in order.
func (d *Deployment) Origins() []string {
	origins := make([]string, len(d.Targets))
	for i, target := range d.Targets {
		origins[i] = target.Origin
	}
	return origins
}

// OriginDeployment is one deployment to one origin. Seq counts the
// deployments to the origin; the newest has the highest.
type OriginDeployment struct {
	Origin       string
	DeploymentID string
	ReleaseID    string
	Kind         DeploymentOriginKind
	DeployedAt   time.Time
	Seq          int64
}

// NewestOriginDeployment returns the newest of deployments, ordered by
// deployed_at then deployment id, or nil for none.
func NewestOriginDeployment(deployments []OriginDeployment) *OriginDeployment {
	var newest *OriginDeployment
	for i := range deployments {
		d := &deployments[i]
		if newest == nil || d.DeployedAt.After(newest.DeployedAt) ||
			(d.DeployedAt.Equal(newest.DeployedAt) && d.DeploymentID > newest.DeploymentID) {
			newest = d
		}
	}
	return newest
}

// SamePrimaryRelease reports whether candidate and current are both primary
// deployments of one release to the same origins. Only then can they be equal.
func SamePrimaryRelease(candidate, current *Deployment) bool {
	return candidate.OriginKind == DeploymentOriginKindPrimary && current != nil &&
		current.OriginKind == DeploymentOriginKindPrimary &&
		current.ReleaseID == candidate.ReleaseID && slices.Equal(current.Origins(), candidate.Origins())
}

// DeploymentsEqual reports whether candidate repeats current, the project's
// newest primary deployment: the same release, the same origins, and the same
// frozen variable set, so writing it would change nothing. A deployment to
// preview URLs never equals one, since writing it renews its previews.
func DeploymentsEqual(candidate, current *Deployment, candidateSetHash, currentSetHash string) bool {
	return SamePrimaryRelease(candidate, current) && candidateSetHash == currentSetHash
}

// CheckExpectedDeployment fails with ErrDeploymentConflict unless expected is
// nil or names current, the deployment the write replaces.
func CheckExpectedDeployment(current *Deployment, expected *string) error {
	if expected == nil || (current != nil && current.ID == *expected) {
		return nil
	}
	return ErrDeploymentConflict(DeploymentConflictDetails{Deployment: current})
}

// DeploymentField enumerates the fields of Deployment which can be used for
// filtering and ordering in list operations.
type DeploymentField uint8

const (
	DeploymentFieldUnspecified DeploymentField = iota
	DeploymentFieldProjectID
	DeploymentFieldID
	DeploymentFieldReleaseID
	DeploymentFieldDeployedAt
	// DeploymentFieldOrigin filters to the deployments that named an origin.
	DeploymentFieldOrigin
	// DeploymentFieldLive filters to the deployments some origin still serves.
	DeploymentFieldLive
	DeploymentFieldOriginKind
	// DeploymentFieldServesOrigin filters to the deployment one origin serves.
	DeploymentFieldServesOrigin
)

// NewDeployment validates the record and sorts its origins. The dialect mints
// the ID and stamps DeployedAt.
func NewDeployment(projectID, releaseID string, kind DeploymentOriginKind, origins []string, metadata DeploymentMetadata) (*Deployment, error) {
	if !metadata.Reason.IsADeploymentReason() {
		return nil, ErrDeploymentInvalid().WithMessage("unknown reason")
	}
	if !kind.IsADeploymentOriginKind() {
		return nil, ErrDeploymentInvalid().WithMessage("unknown origin kind")
	}
	if strings.TrimSpace(releaseID) == "" {
		return nil, ErrDeploymentInvalid().WithMessage("a release_id is required")
	}
	if len(origins) == 0 {
		return nil, ErrDeploymentInvalid().WithMessage("at least one target is required")
	}
	for _, origin := range origins {
		if strings.TrimSpace(origin) == "" {
			return nil, ErrDeploymentInvalid().WithMessage("an origin is empty")
		}
	}
	sorted := slices.Compact(slices.Sorted(slices.Values(origins)))
	if len(sorted) > MaxDeploymentTargets {
		return nil, ErrDeploymentInvalid().WithMessage(fmt.Sprintf("a deployment covers at most %d targets", MaxDeploymentTargets))
	}
	targets := make([]DeploymentTarget, len(sorted))
	for i, origin := range sorted {
		targets[i] = DeploymentTarget{Origin: origin}
	}

	if metadata.RollbackTo != nil {
		if metadata.Reason != DeploymentReasonRollback {
			return nil, ErrDeploymentInvalid().WithMessage("rollback_to is only valid with reason rollback")
		}
		if strings.TrimSpace(*metadata.RollbackTo) == "" {
			return nil, ErrDeploymentInvalid().WithMessage("rollback_to is empty")
		}
	}

	return &Deployment{
		ProjectID:  projectID,
		ReleaseID:  releaseID,
		OriginKind: kind,
		Targets:    targets,
		Metadata:   metadata,
	}, nil
}

// ResolveDeploymentTargets resolves a deployment's origins against
// projectOrigins: previewURLs when it names any, otherwise every primary origin.
// Primary origins are deployed as a whole, so naming one is invalid. A preview
// URL must match a preview pattern and is never a loopback origin.
func ResolveDeploymentTargets(projectOrigins []Origin, previewURLs []string) (DeploymentOriginKind, []string, error) {
	if len(previewURLs) > 0 {
		return resolvePreviewTargets(projectOrigins, previewURLs)
	}
	var origins []string
	for _, o := range projectOrigins {
		if o.Kind == OriginKindPrimary {
			origins = append(origins, o.Pattern)
		}
	}
	if len(origins) == 0 {
		return 0, nil, ErrDeploymentInvalid().WithMessage("the project has no primary origin")
	}
	// TODO(#1572): cap primary origins at MaxDeploymentTargets.
	return DeploymentOriginKindPrimary, origins, nil
}

func resolvePreviewTargets(projectOrigins []Origin, deploymentTargets []string) (DeploymentOriginKind, []string, error) {
	for _, target := range deploymentTargets {
		entry, ok := MatchOrigin(projectOrigins, target)
		switch {
		case ok && entry.Kind == OriginKindPrimary:
			return 0, nil, ErrDeploymentInvalid().WithMessage("deploy to primary origins with the primary target")
		case ok && entry.Kind == OriginKindPreview && !IsLoopbackOrigin(target):
			continue
		default:
			return 0, nil, ErrProjectOriginNotAllowed(map[string]string{"origin": target})
		}
	}
	return DeploymentOriginKindPreview, deploymentTargets, nil
}
