package domain

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
)

func ErrSessionNotFound() error {
	return newError("sess.not_found", "session was not found", nil, nil)
}

// Session represents the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#sessions-durable-post-auth-only)
type Session struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the session within the project and user.
	ID string

	// UserID links to the [User] the session belongs to once associated.
	// A user may have multiple sessions (e.g. from different devices or browsers), and UserID may be nil during some lifecycle stages.
	UserID *string

	// AuthAttempts are deleted as soon as they are handed off to a session and are therefore not accessible on a session.
	Factors []AuthCheck
}

type SessionRepository interface {
	GetByID(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*Session, error)
}
