package domain

import (
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
//go:generate go tool enumer -type DeploymentReason -transform snake -trimprefix DeploymentReason -sql
type DeploymentReason uint8

const (
	DeploymentReasonDeploy DeploymentReason = iota
	DeploymentReasonRollback
)

// DeploymentTargetKind says whether a deployment's targets are primary origins
// or preview URLs. One deployment never mixes them.
//
//go:generate go tool enumer -type DeploymentTargetKind -transform snake -trimprefix DeploymentTargetKind -sql
type DeploymentTargetKind uint8

const (
	DeploymentTargetKindPrimary DeploymentTargetKind = iota
	DeploymentTargetKindPreview
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

// DeploymentConflictDetails carries the newest deployment to the targets in
// its wire shape, nil when nothing was deployed there.
type DeploymentConflictDetails struct {
	Deployment *DeploymentDetails `json:"deployment"`
}

// DeploymentDetails is a deployment as error details render it.
type DeploymentDetails struct {
	ID         string                   `json:"id"`
	ProjectID  string                   `json:"project_id"`
	ReleaseID  string                   `json:"release_id"`
	Targets    []DeploymentTargetDetail `json:"targets"`
	DeployedAt time.Time                `json:"deployed_at"`
	Metadata   DeploymentMetadataDetail `json:"metadata"`
}

type DeploymentTargetDetail struct {
	Origin string `json:"origin"`
}

type DeploymentMetadataDetail struct {
	Reason         string  `json:"reason"`
	Message        *string `json:"message"`
	RollbackTo     *string `json:"rollback_to"`
	DeployedBy     *string `json:"deployed_by"`
	DeployedByType *string `json:"deployed_by_type"`
}

// NewDeploymentConflictDetails renders newest, nil when nothing was deployed.
func NewDeploymentConflictDetails(newest *Deployment) DeploymentConflictDetails {
	if newest == nil {
		return DeploymentConflictDetails{}
	}
	targets := make([]DeploymentTargetDetail, len(newest.Targets))
	for i, target := range newest.Targets {
		targets[i] = DeploymentTargetDetail{Origin: target.Origin}
	}
	var actorType *string
	if newest.Metadata.DeployedByType != nil {
		actorType = new(string(*newest.Metadata.DeployedByType))
	}
	return DeploymentConflictDetails{Deployment: &DeploymentDetails{
		ID:         newest.ID,
		ProjectID:  newest.ProjectID,
		ReleaseID:  newest.ReleaseID,
		Targets:    targets,
		DeployedAt: newest.DeployedAt,
		Metadata: DeploymentMetadataDetail{
			Reason:         newest.Metadata.Reason.String(),
			Message:        newest.Metadata.Message,
			RollbackTo:     newest.Metadata.RollbackTo,
			DeployedBy:     newest.Metadata.DeployedBy,
			DeployedByType: actorType,
		},
	}}
}

// ErrDeploymentConflict reports a failed expected_deployment_id check.
func ErrDeploymentConflict(details DeploymentConflictDetails) Error {
	return newError(PrefixDeployment.ErrorCodePrefix("conflict"), "deployment: the newest deployment to the targets does not match expected_deployment_id", details, nil)
}

// DeploymentMetadata records why the release went live and who did it. A
// caller without a user identity leaves DeployedBy and DeployedByType nil.
type DeploymentMetadata struct {
	Reason  DeploymentReason
	Message *string
	// RollbackTo names the deployment a rollback re-applied.
	RollbackTo     *string
	DeployedBy     *string
	DeployedByType *EventActorType
}

// DeploymentTarget is one origin a deployment covered.
type DeploymentTarget struct {
	Origin string
}

// Deployment is an append-only record of a release going live on a set of
// targets, sorted by origin. What a target serves is the newest deployment
// that names it.
type Deployment struct {
	ProjectID  string
	ID         string
	ReleaseID  string
	TargetKind DeploymentTargetKind
	Targets    []DeploymentTarget
	Metadata   DeploymentMetadata
	DeployedAt time.Time
}

// Origins returns the target origins in order.
func (d *Deployment) Origins() []string {
	origins := make([]string, len(d.Targets))
	for i, target := range d.Targets {
		origins[i] = target.Origin
	}
	return origins
}

// TargetDeployment is one deployment to one origin. Seq counts the
// deployments to the origin; the newest has the highest.
type TargetDeployment struct {
	Origin       string
	DeploymentID string
	ReleaseID    string
	Kind         DeploymentTargetKind
	DeployedAt   time.Time
	Seq          int64
}

// NewestTargetDeployment returns the newest of deployments, ordered by
// deployed_at then deployment id, or nil for none.
func NewestTargetDeployment(deployments []TargetDeployment) *TargetDeployment {
	var newest *TargetDeployment
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
// target serves: its targets are primary origins that all serve its release
// from a primary deployment. A deployment to preview URLs is always written,
// since it renews them.
func (d *Deployment) Unchanged(serving []TargetDeployment) bool {
	if d.TargetKind != DeploymentTargetKindPrimary {
		return false
	}
	byOrigin := make(map[string]TargetDeployment, len(serving))
	for _, s := range serving {
		byOrigin[s.Origin] = s
	}
	for _, target := range d.Targets {
		if s, ok := byOrigin[target.Origin]; !ok || s.ReleaseID != d.ReleaseID || s.Kind != DeploymentTargetKindPrimary {
			return false
		}
	}
	return true
}

// CheckExpectedDeployment fails with ErrDeploymentConflict unless expected is
// nil or names current, the newest deployment to the targets.
func CheckExpectedDeployment(current *Deployment, expected *string) error {
	if expected == nil || (current != nil && current.ID == *expected) {
		return nil
	}
	return ErrDeploymentConflict(NewDeploymentConflictDetails(current))
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
	// DeploymentFieldLive filters to the deployments some target still serves.
	DeploymentFieldLive
)

// NewDeployment validates the record and sorts its targets. The dialect mints
// the ID and stamps DeployedAt.
func NewDeployment(projectID, releaseID string, kind DeploymentTargetKind, origins []string, metadata DeploymentMetadata) (*Deployment, error) {
	if !metadata.Reason.IsADeploymentReason() {
		return nil, ErrDeploymentInvalid("unknown reason", nil)
	}
	if !kind.IsADeploymentTargetKind() {
		return nil, ErrDeploymentInvalid("unknown target kind", nil)
	}
	if strings.TrimSpace(releaseID) == "" {
		return nil, ErrDeploymentInvalid("a release_id is required", nil)
	}
	if len(origins) == 0 {
		return nil, ErrDeploymentInvalid("at least one target is required", nil)
	}
	for _, origin := range origins {
		if strings.TrimSpace(origin) == "" {
			return nil, ErrDeploymentInvalid("a target origin is empty", nil)
		}
	}
	// Sorts into a new slice: the caller's argument is not ours to reorder.
	sorted := slices.Compact(slices.Sorted(slices.Values(origins)))
	if len(sorted) > MaxDeploymentTargets {
		return nil, ErrDeploymentInvalid("a deployment covers at most 50 targets", nil)
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
		TargetKind: kind,
		Targets:    targets,
		Metadata:   metadata,
	}, nil
}
