package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// Session represents the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#sessions-durable-post-auth-only)
type Session struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the session within the project and user.
	ID string

	// CreatedAt is the time when the session was created, it must be set by the storage and is read only.
	CreatedAt time.Time
	// UpdatedAt is the time when the session was last updated, it must be set by the storage and is read only.
	UpdatedAt time.Time
	// ExpiresAt is the time when the session expires. Is used for garbage collection.
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
	// Factors contains the authentication factors that were used to verify the session.
	// There is one factor per [AuthCheckType].
	// The factors must be verified using [AuthAttempt]s before being added to the session, and the VerifiedAt field must be set to the time of verification.
	// The factors are stored in the database.
	Factors []*SessionFactor
}

type SessionFactor struct {
	Type       AuthCheckType
	VerifiedAt time.Time
	// Stored as jsonb
	Factor any
}

func (s *Session) GetFactor(typ AuthCheckType) *SessionFactor {
	for _, factor := range s.Factors {
		if factor.Type == typ {
			return factor
		}
	}
	return nil
}

type SessionState uint8

const (
	SessionStateUnspecified SessionState = iota
	SessionStateBuilding
	SessionStateActive
	SessionStateExpired
)

type SessionRepository interface {
	// Create persists a new session (including all the fields which are set in the struct).
	//
	// The token must be unique across all sessions and is used for authentication,
	// so it should be generated securely (e.g. using a cryptographically secure random generator) and should not be guessable.
	//
	// The storage must set the read only fields (CreatedAt, UpdatedAt) and return an error if any of the required fields are missing.
	Create(ctx context.Context, session *Session) error

	// GetByID retrieves a session by its project and session ID.
	GetByID(ctx context.Context, projectID, sessionID string) (*Session, error)
	// GetByToken retrieves a session by its project and token.
	GetByToken(ctx context.Context, projectID, token string) (*Session, error)

	// List returns a list of sessions based on the given condition.
	List(ctx context.Context, opts ...database.QueryOption) ([]*Session, error)

	// Merges an auth attempt into a session by its project and session ID. The auth attempt is identified by its handoff token.
	// Merges the succeeded checks of the auth attempt into the session as factors.
	// The checks are merged based on the authenticator identifier. The latest succeeded (not handed off at) check wins.
	MergeAttempt(ctx context.Context, projectID, sessionID, handoffToken string) (*Session, error)

	// Deletes a session by its project and session ID.
	// It does NOT return an error if the session does not exist.
	Delete(ctx context.Context, projectID, sessionID string) error

	SessionConditions
	SessionColumns
}

// Conditions to list sessions, used for filtering in [SessionRepository.List].
type SessionConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	IDCondition(sessionID string) database.Condition
	IsExpiredCondition() database.Condition
	UserIDCondition(userID string) database.Condition
}

// Columns for the session table, used for ordering.
type SessionColumns interface {
	ProjectIDColumn() database.Column
	IDColumn() database.Column
	CreatedAtColumn() database.Column
	UpdatedAtColumn() database.Column
	ExpiresAtColumn() database.Column
	TokenColumn() database.Column
	UserIDColumn() database.Column
	UserAgentColumn() database.Column
	FactorsColumn() database.Column
}
