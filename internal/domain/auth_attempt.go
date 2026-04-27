package domain

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// AuthAttempt represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#auth-flows)
// It is short lived and should therefore be stored near the client, do not store PII data in it.
type AuthAttempt struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the auth attempt within the project.
	ID string
	// UserID links to the [User] the auth attempt belongs to.
	// It is possible that an auth attempt does not belong to a user yet (before the [ChallengeTypeUser] is completed).
	UserID *string
	// Links to the [Challenge]s that belong to the auth attempt.
	// An auth attempt can have multiple challenges (e.g. for multi-factor authentication), but a challenge can only belong to one auth attempt.
	Factors []*Challenge
}

type AuthAttemptRepository interface {
	Get(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*AuthAttempt, error)
	Create(ctx context.Context, client database.QueryExecutor, authAttempt *AuthAttempt) error
	Delete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error

	Update(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string)

	AddChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenge *Challenge) error
	VerifyChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID, challengeID string, success bool) error

	Complete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error
	Handoff(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID, sessionID string) error
}
