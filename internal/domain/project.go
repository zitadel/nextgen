package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

const PrefixProject ResourcePrefix = "proj"

type ProjectLifecycle string

const (
	ProjectLifecycleUnclaimed ProjectLifecycle = "unclaimed"
	ProjectLifecycleClaimed   ProjectLifecycle = "claimed"
)

type ProjectTier string

const (
	ProjectTierFree       ProjectTier = "free"
	ProjectTierPro        ProjectTier = "pro"
	ProjectTierEnterprise ProjectTier = "enterprise"
)

func ErrProjectNotFound() Error {
	return newError(PrefixProject.ErrorCodePrefix("not_found"), "project not found", nil, nil)
}

func ErrProjectClaimRequired() Error {
	return newError(PrefixProject.ErrorCodePrefix("claim_required"), "project must be claimed before this operation", nil, nil)
}

func ErrProjectAlreadyClaimed() Error {
	return newError(PrefixProject.ErrorCodePrefix("already_claimed"), "project is already claimed", nil, nil)
}

func ErrProjectClaimNotFound() Error {
	return newError(PrefixProject.ErrorCodePrefix("claim_not_found"), "project claim challenge not found", nil, nil)
}

func ErrProjectClaimExpired() Error {
	return newError(PrefixProject.ErrorCodePrefix("claim_expired"), "project claim challenge expired", nil, nil)
}

func ErrProjectSecretConsumed() Error {
	return newError(PrefixProject.ErrorCodePrefix("secret_consumed"), "rotated project secret was already retrieved", nil, nil)
}

func ErrProjectIdempotencyConflict() Error {
	return newError(PrefixProject.ErrorCodePrefix("idempotency_conflict"), "idempotency key was reused with a different request body", nil, nil)
}

// Project is a minimal representation of the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#projects)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Project struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	// ProjectSecret is a bearer token that authenticates API calls for this project.
	// Callers of [ProjectRepository.Create] must pre-populate this field; the
	// repository does not generate it.
	ProjectSecret string
	// PreviewSecret is an origin-scoped bearer token for preview/testing.
	// Callers of [ProjectRepository.Create] must pre-populate this field.
	PreviewSecret string
	// PreviewOrigins are the allowed origins for the preview secret.
	// Callers of [ProjectRepository.Create] must pre-populate this field.
	PreviewOrigins []string
	Lifecycle      ProjectLifecycle
	TeamID         string
	Tier           ProjectTier
	ClaimedAt      *time.Time
}

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/project.mock.go . ProjectRepository

// ProjectRepository provides storage operations for [Project]s.
type ProjectRepository interface {
	// Create persists a new project. The repository sets [Project.CreatedAt] and
	// [Project.UpdatedAt] to the current time; callers should not pre-populate
	// those fields. Callers MUST pre-populate [Project.ProjectSecret],
	// [Project.PreviewSecret], and [Project.PreviewOrigins].
	// Returns an [database.IntegrityViolationError] (specifically [database.UniqueError])
	// if a project with the same ID already exists.
	Create(ctx context.Context, client database.QueryExecutor, project *Project) error

	// Get retrieves a project by its ID.
	// Returns a [database.NoRowFoundError] when no project with the given ID exists.
	Get(ctx context.Context, client database.QueryExecutor, id string) (*Project, error)

	// GetBySecret retrieves a project by a full-access or preview project secret.
	// Returns a [database.NoRowFoundError] when no project with the given secret exists.
	GetBySecret(ctx context.Context, client database.QueryExecutor, secret string) (*Project, error)

	// Update persists mutable project lifecycle fields.
	Update(ctx context.Context, client database.QueryExecutor, project *Project) error
}
