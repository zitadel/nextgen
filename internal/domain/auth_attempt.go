package domain

import (
	"context"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// AuthAttempt represents the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#auth-flows)
// It is short lived and should therefore be stored near the client, do not store PII data in it.
type AuthAttempt struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the auth attempt within the project.
	ID string

	// Links to the [AuthChecker]s that belong to the auth attempt.
	// An auth attempt can have multiple checks (e.g. for multi-factor authentication), but a check can only belong to one auth attempt.
	Checks         []AuthChecker
	RequiredChecks []AuthCheckType

	// The time when the auth attempt was created, it must be set by the storage and is read only.
	CreatedAt time.Time
	// The time when the auth attempt was completed, it must be set by the storage and is read only. An auth attempt is completed when all required checks are verified successfully.
	CompletedAt *time.Time

	// TTL describes how long an auth attempt is valid, it should be set to a reasonable value (e.g. 5 minutes) to prevent abuse and to ensure that old auth attempts are cleaned up.
	// An auth attempt gets garbage collected after CreatedAt + TimeToLive, so it is important to set it to a reasonable value to prevent abuse and to ensure that old auth attempts are cleaned up.
	TimeToLive *time.Duration
}

func CheckAs[T AuthChecker](attempt *AuthAttempt, typ AuthCheckType) (T, bool) {
	check, ok := attempt.CheckByType(typ)
	if !ok {
		var zero T
		return zero, false
	}
	typedCheck, ok := check.(T)
	return typedCheck, ok
}

func (a *AuthAttempt) IsExpired() bool {
	if a.CreatedAt.IsZero() || a.TimeToLive == nil {
		return false
	}
	return time.Now().After(a.CreatedAt.Add(*a.TimeToLive))
}

func (a *AuthAttempt) IsCompleted() bool {
	// An auth attempt is completed if all required checks are verified successfully.
	for _, requiredCheck := range a.RequiredChecks {
		check, ok := a.CheckByType(requiredCheck)
		if !ok || check.Check().LastVerifiedAt.IsZero() {
			return false
		}
	}
	return true
}

func (a *AuthAttempt) CheckByType(typ AuthCheckType) (AuthChecker, bool) {
	index := slices.IndexFunc(a.Checks, func(check AuthChecker) bool {
		return check.Check().IsType(typ)
	})
	if index == -1 {
		return nil, false
	}
	return a.Checks[index], true
}

type AuthAttemptRepository interface {
	// Get a single AuthAttempt by its ID and project ID.
	Get(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*AuthAttempt, error)
	// Creates an auth attempt including all defined fields (except read-only fields).
	// The repository MUST set the [AuthAttempt.CreatedAt] field to the current time.
	Create(ctx context.Context, client database.QueryExecutor, authAttempt *AuthAttempt) error
	// Delete an auth attempt by its ID and project ID.
	Delete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error

	Complete(ctx context.Context, client database.QueryExecutor, check *AuthAttempt) error
	Handoff(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID, sessionID string) error

	// SetChallenge sets a check to challenged and sets the challenge payload.
	// If the check is not stored yet the method creates a new check with the given type and challenge payload, otherwise it updates the existing check with the new challenge payload.
	// The repository MUST set the [AuthCheck.LastChallengeAt] field of the check to the current time, reset the [AuthCheck.LastFailedAt] field to nil and reset the [AuthCheck.FailureCount] field to 0, and store the values accordingly.
	SetChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenger AuthChallenger) error
	// ChallengeSucceeded sets the [AuthCheck.LastVerifiedAt] field of the check to the current time and stores it accordingly, and removes the challenge payload from the storage.
	// If the check is not stored yet, the method creates a new check with the given type and sets the [AuthCheck.LastVerifiedAt] field to the current time, and stores it accordingly.
	// If the check implements [AuthFactorer], the repository MUST also set the factor payload to the value returned by the [AuthFactorer.FactorPayload] method, and store it accordingly.
	ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, checker AuthChecker) error
	// ChallengeFailed sets a check to failed.
	// If the check is not stored yet, the method creates a new check with the given type and sets the [AuthCheck.LastFailedAt] field to the current time and the [AuthCheck.FailureCount] field to 1, and stores it accordingly.
	// The repository MUST set the [AuthCheck.LastFailedAt] field of the check to the current time and increment the [AuthCheck.FailureCount] field by 1, and store the values accordingly.
	ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, checker AuthChecker) error
}
