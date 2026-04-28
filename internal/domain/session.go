package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// SessionState represents the lifecycle state of a session.
type SessionState string

const (
	SessionStateBuilding SessionState = "building"
	SessionStateActive   SessionState = "active"
	SessionStateExpired  SessionState = "expired"
	SessionStateRevoked  SessionState = "revoked"
)

// Session represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#sessions-durable-post-auth-only)
type Session struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the session within the project and user.
	ID string
	// Version is incremented on every session mutation.
	Version int64

	// State defines the lifecycle stage of the session.
	State SessionState
	// UserID links to the [User] the session belongs to once associated.
	// A user may have multiple sessions (e.g. from different devices or browsers), and UserID may be nil during some lifecycle stages.
	UserID *string

	// Factors stores verified authentication factors.
	Factors map[string]any
	// AssuranceLevels stores all assurance levels currently satisfied by [Factors].
	AssuranceLevels []string
	// Metadata stores session metadata.
	Metadata map[string]any
	// UserAgent stores optional user agent data submitted with anonymous session creation.
	UserAgent map[string]any

	CreatedAt time.Time
	ExpiresAt *time.Time
}

type SessionListFilter struct {
	ProjectID string
	UserID    *string
	State     *SessionState
	Limit     uint64
	Offset    uint64
}

type SessionRepository interface {
	Get(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) (*Session, error)
	Create(ctx context.Context, client database.QueryExecutor, session *Session) error
	Revoke(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) error
	List(ctx context.Context, client database.QueryExecutor, filter SessionListFilter) ([]*Session, uint64, error)
}
