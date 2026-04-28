package domain

import (
	"context"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// AuthAttempt represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#auth-flows)
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

	// The time when the auth attempt was created, it must be set by the storage and is ready only.
	CreatedAt time.Time
	// The time when the auth attempt was completed, it must be set by the storage and is ready only. An auth attempt is completed when all required checks are verified successfully.
	CompletedAt *time.Time

	// TTL describes how long an auth attempt is valid, it should be set to a reasonable value (e.g. 5 minutes) to prevent abuse and to ensure that old auth attempts are cleaned up.
	// An auth attempt gets garbage collected after CreatedAt + TimeToLive, so it is important to set it to a reasonable value to prevent abuse and to ensure that old auth attempts are cleaned up.
	TimeToLive *time.Duration
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
		if !ok || check.Check().VerifiedAt.IsZero() {
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
	Get(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*AuthAttempt, error)
	Create(ctx context.Context, client database.QueryExecutor, authAttempt *AuthAttempt) error
	Delete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error

	SetCheck(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, checker AuthChecker) error
	// CheckSucceeded sets a check to succeeded.
	// The repository MUST set the [AuthCheck.VerifiedAt] field of the check to the current time and store the value accordingly.
	// TODO(adlerhurst): do we need to set [AuthCheck.Factor] to the current value?
	// TODO(adlerhurst): do we need to reset [AuthCheck.LastFailedAt] and [AuthCheck.FailureCount] when a check is set to succeeded?
	CheckSucceeded(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, check *AuthCheck) error
	// CheckFailed sets a check to failed.
	// The repository MUST set the [AuthCheck.LastFailedAt] field of the check to the current time and increment the [AuthCheck.FailureCount] field by 1, and store the values accordingly.
	// TODO(adlerhurst): do we need to reset [AuthCheck.VerifiedAt] when a check is set to failed?
	// TODO(adlerhurst): do we need to provide options to set [AuthCheck.VerifiedAt], [AuthCheck.LastFailedAt], and [AuthCheck.FailureCount]?
	CheckFailed(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, check *AuthCheck) error

	Complete(ctx context.Context, client database.QueryExecutor, check *AuthAttempt) error
	Handoff(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID, sessionID string) error
}
