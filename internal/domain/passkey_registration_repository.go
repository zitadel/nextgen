package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

const PrefixPasskeyRegistration ResourcePrefix = "pkreg"

func ErrPasskeyRegistrationNotFound() Error {
	return NewError(PrefixPasskeyRegistration.ErrorCodePrefix("not_found"), "passkey registration session not found or expired", nil, nil)
}

// PasskeyRegistration is a pending WebAuthn registration session. It is
// created by BeginRegistration and consumed (then deleted) by FinishRegistration.
type PasskeyRegistration struct {
	ID        string
	ProjectID string
	UserID    string
	Challenge *PasskeyRegistrationChallenge
	ExpiresAt time.Time
	CreatedAt time.Time
}

// CreatePasskeyRegistration is the input DTO for persisting a new session.
type CreatePasskeyRegistration struct {
	ID        string
	ProjectID string
	UserID    string
	Challenge *PasskeyRegistrationChallenge
	ExpiresAt time.Time
}

// PasskeyRegistrationRepository persists pending registration sessions.
type PasskeyRegistrationRepository interface {
	// Create stores a new pending registration session.
	Create(ctx context.Context, client database.QueryExecutor, reg *CreatePasskeyRegistration) error

	// Get retrieves a session by its id. Returns an error if not found or expired.
	Get(ctx context.Context, client database.QueryExecutor, projectID, id string) (*PasskeyRegistration, error)

	// Delete removes the session after it has been used (or abandoned).
	Delete(ctx context.Context, client database.QueryExecutor, projectID, id string) error
}
