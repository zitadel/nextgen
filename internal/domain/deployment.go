package domain

import (
	"strings"
	"time"
)

const (
	PrefixDeployment ResourcePrefix = "dep"
	// PrefixDeploy names the correlation id shared by every row one deploy
	// wrote. It is minted once per deploy, never per row.
	PrefixDeploy ResourcePrefix = "dpl"
)

// DeploymentReason records why a deployment was created. All three are the
// same operation — a new row naming the release a target serves — and the
// reason keeps the caller's intent on the record.
//
//go:generate go tool enumer -type DeploymentReason -transform snake -trimprefix DeploymentReason -sql
type DeploymentReason uint8

const (
	DeploymentReasonDeploy DeploymentReason = iota
	DeploymentReasonPromote
	DeploymentReasonRollback
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

// DeploymentConflictDetails is the payload of ErrDeploymentConflict: what the
// target actually serves, so the caller can decide whether to retry on top of
// it. Both fields are empty when the target has no deployment yet.
type DeploymentConflictDetails struct {
	CurrentDeploymentID string `json:"current_deployment_id,omitempty"`
	CurrentReleaseID    string `json:"current_release_id,omitempty"`
}

// ErrDeploymentConflict reports a failed expected_deployment_id check: the
// target's newest deployment is not the one the caller expected, and nothing
// was changed.
func ErrDeploymentConflict(details DeploymentConflictDetails) Error {
	return newError(PrefixDeployment.ErrorCodePrefix("conflict"), "deployment: the target's newest deployment does not match expected_deployment_id", details, nil)
}

// DeploymentMetadata records why the release went live and who made it
// happen. Set at creation and never mutated. Everything here is enrichment —
// the origin, release and timestamp on the deployment itself say what ran
// where and when — which is why it lives in one document rather than in
// columns: nothing filters or orders on it, and a new field costs no
// migration.
//
// DeployedBy and DeployedByType mirror the actor recording on releases: a
// caller without a user identity (for example, a project secret used from CI)
// leaves both fields nil.
type DeploymentMetadata struct {
	Reason DeploymentReason
	// Message is the caller's summary of why this deployment happened,
	// analogous to a git commit message.
	Message *string
	// RollbackOf is the deploy id a rollback reversed, so the trail reads
	// forwards and backwards. Set exactly when Reason is rollback.
	RollbackOf     *string
	DeployedBy     *string
	DeployedByType *EventActorType
}

// Deployment is an immutable, project-scoped record of a release being made
// live on one target. Rows are append-only: one is written per target when
// the target starts serving the release and never changes afterwards. What a
// target serves is its newest row.
//
// Origin is the target: the empty string is the project default, anything
// else an exact origin. DeployID correlates the rows one deploy wrote.
type Deployment struct {
	ProjectID  string
	ID         string
	DeployID   string
	Origin     string
	ReleaseID  string
	Metadata   DeploymentMetadata
	DeployedAt time.Time
}

// DeploymentField enumerates the fields of Deployment which can be used for
// filtering and ordering in list operations. The metadata lives in a column
// no query filters on, so it is not bound.
type DeploymentField uint8

const (
	DeploymentFieldUnspecified DeploymentField = iota
	DeploymentFieldProjectID
	DeploymentFieldID
	DeploymentFieldDeployID
	DeploymentFieldOrigin
	DeploymentFieldReleaseID
	DeploymentFieldDeployedAt
)

// NewDeployment validates one row. The ID is left empty for the dialect to
// mint, DeployID is set by the caller once for the whole set, and DeployedAt
// is stamped by the insert. An empty origin is the project default.
//
// A zero metadata is a plain deploy: DeploymentReasonDeploy is the zero value
// of the enum, matching the wire default.
func NewDeployment(projectID, origin, releaseID string, metadata DeploymentMetadata) (*Deployment, error) {
	if !metadata.Reason.IsADeploymentReason() {
		return nil, ErrDeploymentInvalid("unknown reason", nil)
	}
	if strings.TrimSpace(releaseID) == "" {
		return nil, ErrDeploymentInvalid("a release is required", nil)
	}
	if origin != "" {
		normalized, err := NormalizeOrigin(origin)
		if err != nil {
			return nil, ErrDeploymentInvalid("origin must be scheme://host[:port]", err)
		}
		origin = normalized
	}

	// rollback_of means "the deploy this one reversed", so it is required
	// exactly when there is a rollback to record and rejected otherwise rather
	// than silently dropped.
	if metadata.Reason == DeploymentReasonRollback {
		if metadata.RollbackOf == nil || strings.TrimSpace(*metadata.RollbackOf) == "" {
			return nil, ErrDeploymentInvalid("reason rollback requires rollback_of", nil)
		}
	} else if metadata.RollbackOf != nil {
		return nil, ErrDeploymentInvalid("rollback_of is only valid with reason rollback", nil)
	}

	return &Deployment{
		ProjectID: projectID,
		Origin:    origin,
		ReleaseID: releaseID,
		Metadata:  metadata,
	}, nil
}
