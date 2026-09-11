package domain

import (
	"strings"
	"time"
)

const (
	PrefixDeployment ResourcePrefix = "dep"
)

// DeploymentReason records why a deployment was created. All three are the
// same operation — a new deployment pointing the environment at a release —
// and the reason keeps the caller's intent on the record.
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
// environment actually runs, so the caller can decide whether to retry on top
// of it. Both fields are empty when the environment has no deployment yet.
type DeploymentConflictDetails struct {
	CurrentDeploymentID string `json:"current_deployment_id,omitempty"`
	CurrentReleaseID    string `json:"current_release_id,omitempty"`
}

// ErrDeploymentConflict reports a failed expected_current_deployment_id
// check: the environment's current deployment is not the one the caller
// expected, and nothing was changed.
func ErrDeploymentConflict(details DeploymentConflictDetails) Error {
	return newError(PrefixDeployment.ErrorCodePrefix("conflict"), "deployment: the environment's current deployment does not match expected_current_deployment_id", details, nil)
}

// DeploymentMetadata records why the release went live and who made it
// happen. Set at creation and never mutated. Everything here is enrichment —
// the ids and timestamp on the deployment itself say what ran where and when
// — which is why it lives in one document rather than in columns: nothing
// filters or orders on it, and a new field costs no migration.
//
// DeployedBy and DeployedByType mirror the actor recording on releases: a
// caller without a user identity (for example, a project secret used from CI)
// leaves both fields nil.
type DeploymentMetadata struct {
	Reason              DeploymentReason
	SourceEnvironmentID *string
	DeployedBy          *string
	DeployedByType      *EventActorType
}

// Deployment is an immutable, project-scoped record of a release being made
// live on an environment. Rows are append-only: one is written when the
// environment starts running the release and never changes afterwards.
//
// Environments are referenced by id. Names are resolved before the entity is
// built, so renaming an environment later does not reattach its history, and
// the metadata's SourceEnvironmentID may name an environment that has since
// been deleted.
type Deployment struct {
	ProjectID     string
	ID            string
	EnvironmentID string
	ReleaseID     string
	Metadata      DeploymentMetadata
	DeployedAt    time.Time
}

// DeploymentField enumerates the fields of Deployment which can be used for
// filtering and ordering in list operations. The metadata lives in a column
// no query filters on, so it is not bound.
type DeploymentField uint8

const (
	DeploymentFieldUnspecified DeploymentField = iota
	DeploymentFieldProjectID
	DeploymentFieldID
	DeploymentFieldEnvironmentID
	DeploymentFieldReleaseID
	DeploymentFieldDeployedAt
)

// NewDeployment validates the record. The ID is left empty for the dialect to
// mint, and DeployedAt is stamped by the insert. The ids are already resolved
// — the API edge turns environment names into ids before building the entity.
//
// A zero metadata is a plain deploy: DeploymentReasonDeploy is the zero value
// of the enum, matching the wire default.
func NewDeployment(projectID, environmentID, releaseID string, metadata DeploymentMetadata) (*Deployment, error) {
	if !metadata.Reason.IsADeploymentReason() {
		return nil, ErrDeploymentInvalid("unknown reason", nil)
	}
	if strings.TrimSpace(environmentID) == "" {
		return nil, ErrDeploymentInvalid("an environment is required", nil)
	}
	if strings.TrimSpace(releaseID) == "" {
		return nil, ErrDeploymentInvalid("a release_id is required", nil)
	}

	// source_environment means "where the release was promoted from", so it
	// is required exactly when there is a promotion to record and rejected
	// otherwise rather than silently dropped.
	if metadata.Reason == DeploymentReasonPromote {
		if metadata.SourceEnvironmentID == nil || strings.TrimSpace(*metadata.SourceEnvironmentID) == "" {
			return nil, ErrDeploymentInvalid("reason promote requires source_environment", nil)
		}
	} else if metadata.SourceEnvironmentID != nil {
		return nil, ErrDeploymentInvalid("source_environment is only valid with reason promote", nil)
	}

	return &Deployment{
		ProjectID:     projectID,
		EnvironmentID: environmentID,
		ReleaseID:     releaseID,
		Metadata:      metadata,
	}, nil
}
