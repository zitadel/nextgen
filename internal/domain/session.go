package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// Session represents the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#sessions-durable-post-auth-only)
type Session struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the session within the project and user.
	ID string

	CreatedAt time.Time
	UpdatedAt time.Time
	ExpiresAt time.Time

	// Token is the opaque string that changes on every update.
	Token string

	// UserID links to the [User] the session belongs to once associated.
	// A user may have multiple sessions (e.g. from different devices or browsers), and UserID may be nil during some lifecycle stages.
	UserID *string

	// UserAgent contains information about the user's device and browser.
	UserAgent map[string]any

	// State is computed at runtime and therefore not stored in the database.
	State SessionState
	// AssuranceLevels are computed at runtime and therefore not stored in the database.
	AssuranceLevels []string

	Factors []*SessionFactor
	// AuthAttempts are deleted as soon as they are handed off to a session and are therefore not accessible on a session.
}

type SessionFactor struct {
	Type       AuthCheckType
	VerifiedAt time.Time
	// Stored as jsonb
	Payload any
}

type SessionState uint8

const (
	SessionStateUnspecified SessionState = iota
	SessionStateBuilding
	SessionStateActive
	SessionStateExpired
	SessionStateRevoked
)

type SessionRepository interface {
	// Create persists a new session.
	Create(ctx context.Context, client database.QueryExecutor, session *Session) error

	// Get retrieves a session by its project and session ID.
	Get(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) (*Session, error)

	Exchange(ctx context.Context, client database.QueryExecutor, session *Session, attempt *AuthAttempt) error
}
