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

// DeploymentReason records why a deployment was created. Both are the same
// operation — a new deployment pointing its targets at a release — and the
// reason keeps the caller's intent on the record.
//
//go:generate go tool enumer -type DeploymentReason -transform snake -trimprefix DeploymentReason -sql
type DeploymentReason uint8

const (
	DeploymentReasonDeploy DeploymentReason = iota
	DeploymentReasonRollback
)

// DeploymentTargetKind says what the targets of a deployment are: primary
// origins of the project, or preview URLs. One deployment never mixes them.
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

// DeploymentConflictDetails is the payload of ErrDeploymentConflict: the
// newest deployment to any of the targets, so the caller can decide whether to
// retry on top of it. Deployment is nil when nothing was ever deployed there.
type DeploymentConflictDetails struct {
	Deployment *Deployment `json:"deployment"`
}

// ErrDeploymentConflict reports a failed expected_deployment_id check: the
// newest deployment to the targets is not the one the caller expected, and
// nothing was changed.
func ErrDeploymentConflict(details DeploymentConflictDetails) Error {
	return newError(PrefixDeployment.ErrorCodePrefix("conflict"), "deployment: the newest deployment to the targets does not match expected_deployment_id", details, nil)
}

// DeploymentMetadata records why the release went live and who made it
// happen. Set at creation and never mutated. Everything here is enrichment —
// the ids, targets and timestamp on the deployment itself say what ran where
// and when — which is why it lives in one document rather than in columns:
// nothing filters or orders on it, and a new field costs no migration.
//
// DeployedBy and DeployedByType mirror the actor recording on releases: a
// caller without a user identity (for example, a project secret used from CI)
// leaves both fields nil.
type DeploymentMetadata struct {
	Reason DeploymentReason
	// Message is the caller's summary of why this deployment happened,
	// analogous to a git commit message.
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

// Deployment is an immutable, project-scoped record of a release being made
// live on a set of targets. Rows are append-only: one is written, with every
// target, when the targets start serving the release, and never changes
// afterwards. What a target serves is the newest deployment that names it.
//
// Targets are origin strings, not references: an origin keeps its history
// after the pattern or preview that admitted it is gone. Targets are sorted by
// origin.
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

// DeploymentField enumerates the fields of Deployment which can be used for
// filtering and ordering in list operations. The metadata lives in a column
// no query filters on, so it is not bound.
type DeploymentField uint8

const (
	DeploymentFieldUnspecified DeploymentField = iota
	DeploymentFieldProjectID
	DeploymentFieldID
	DeploymentFieldReleaseID
	DeploymentFieldDeployedAt
	// DeploymentFieldOrigin matches the deployments that named an origin. It
	// filters, never orders.
	DeploymentFieldOrigin
	// DeploymentFieldLive matches the deployments that some target still
	// serves: the newest deployment to at least one of their targets. It
	// filters, never orders.
	DeploymentFieldLive
)

// NewDeployment validates the record and puts its targets in canonical order.
// The ID is left empty for the dialect to mint, and DeployedAt is stamped by
// the insert. The release is already resolved to its id and the targets to
// exact origins.
//
// A zero metadata is a plain deploy: DeploymentReasonDeploy is the zero value
// of the enum, matching the wire default.
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

	// rollback_to names what a rollback re-applied, so it is required exactly
	// when there is a rollback to record and rejected otherwise rather than
	// silently dropped.
	if metadata.Reason == DeploymentReasonRollback {
		if metadata.RollbackTo == nil || strings.TrimSpace(*metadata.RollbackTo) == "" {
			return nil, ErrDeploymentInvalid("reason rollback requires rollback_to", nil)
		}
	} else if metadata.RollbackTo != nil {
		return nil, ErrDeploymentInvalid("rollback_to is only valid with reason rollback", nil)
	}

	targets := make([]DeploymentTarget, len(sorted))
	for i, origin := range sorted {
		targets[i] = DeploymentTarget{Origin: origin}
	}
	return &Deployment{
		ProjectID:  projectID,
		ReleaseID:  releaseID,
		TargetKind: kind,
		Targets:    targets,
		Metadata:   metadata,
	}, nil
}
