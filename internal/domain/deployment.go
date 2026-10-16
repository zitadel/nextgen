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

func ErrDeploymentInvalid(details any, parent error) Error {
	return newError(PrefixDeployment.ErrorCodePrefix("invalid"), "deployment: invalid", details, parent)
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
// origins, sorted. What an origin serves is the newest deployment that names
// it.
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

// Unchanged reports whether writing d would change nothing, given what each
// origin serves: its origins are primary ones that all serve its release from
// a primary deployment. A deployment to preview URLs is always written,
// since it renews them.
func (d *Deployment) Unchanged(serving []OriginDeployment) bool {
	if d.OriginKind != DeploymentOriginKindPrimary {
		return false
	}
	byOrigin := make(map[string]OriginDeployment, len(serving))
	for _, s := range serving {
		byOrigin[s.Origin] = s
	}
	for _, target := range d.Targets {
		if s, ok := byOrigin[target.Origin]; !ok || s.ReleaseID != d.ReleaseID || s.Kind != DeploymentOriginKindPrimary {
			return false
		}
	}
	return true
}

// CheckExpectedDeployment fails with ErrDeploymentConflict unless expected is
// nil or names current, the newest deployment to the origins.
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
)

// NewDeployment validates the record and sorts its origins. The dialect mints
// the ID and stamps DeployedAt.
func NewDeployment(projectID, releaseID string, kind DeploymentOriginKind, origins []string, metadata DeploymentMetadata) (*Deployment, error) {
	if !metadata.Reason.IsADeploymentReason() {
		return nil, ErrDeploymentInvalid("unknown reason", nil)
	}
	if !kind.IsADeploymentOriginKind() {
		return nil, ErrDeploymentInvalid("unknown origin kind", nil)
	}
	if strings.TrimSpace(releaseID) == "" {
		return nil, ErrDeploymentInvalid("a release_id is required", nil)
	}
	if len(origins) == 0 {
		return nil, ErrDeploymentInvalid("at least one target is required", nil)
	}
	for _, origin := range origins {
		if strings.TrimSpace(origin) == "" {
			return nil, ErrDeploymentInvalid("an origin is empty", nil)
		}
	}
	sorted := slices.Compact(slices.Sorted(slices.Values(origins)))
	if len(sorted) > MaxDeploymentTargets {
		return nil, ErrDeploymentInvalid(fmt.Sprintf("a deployment covers at most %d targets", MaxDeploymentTargets), nil)
	}
	targets := make([]DeploymentTarget, len(sorted))
	for i, origin := range sorted {
		targets[i] = DeploymentTarget{Origin: origin}
	}

	if metadata.Reason == DeploymentReasonRollback {
		if metadata.RollbackTo == nil || strings.TrimSpace(*metadata.RollbackTo) == "" {
			return nil, ErrDeploymentInvalid("reason rollback requires rollback_to", nil)
		}
	} else if metadata.RollbackTo != nil {
		return nil, ErrDeploymentInvalid("rollback_to is only valid with reason rollback", nil)
	}

	return &Deployment{
		ProjectID:  projectID,
		ReleaseID:  releaseID,
		OriginKind: kind,
		Targets:    targets,
		Metadata:   metadata,
	}, nil
}
