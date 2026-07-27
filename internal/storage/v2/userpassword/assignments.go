package userpassword

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Assignments maps domain password changes to SQL column assignments.
func Assignments(changes []domain.UserPasswordChange) ([]database.Assignment, error) {
	if len(changes) == 0 {
		return nil, database.ErrNoChanges
	}
	out := make([]database.Assignment, 0, len(changes))
	for i, c := range changes {
		a, err := assignment(c)
		if err != nil {
			return nil, fmt.Errorf("change %d: %w", i, err)
		}
		out = append(out, a)
	}
	return out, nil
}

func assignment(c domain.UserPasswordChange) (database.Assignment, error) {
	switch c.Kind() {
	case domain.UserPasswordChangeSetEncodedHash:
		return database.Assignment{Column: "encoded_hash", Value: c.Text()}, nil
	case domain.UserPasswordChangeSetChangeRequired:
		return database.Assignment{Column: "change_required", Value: c.Bool()}, nil
	case domain.UserPasswordChangeSetChangedAt:
		return database.Assignment{Column: "changed_at", Value: c.Time()}, nil
	case domain.UserPasswordChangeSetVerificationID:
		return database.Assignment{Column: "verification_id", Value: c.Text()}, nil
	case domain.UserPasswordChangeSetLastSuccessfulCheck:
		return database.Assignment{Column: "last_successful_check", Value: c.Time()}, nil
	case domain.UserPasswordChangeIncrementFailedAttempts:
		return database.Assignment{Column: "failed_attempts", Expr: "failed_attempts + 1"}, nil
	case domain.UserPasswordChangeResetFailedAttempts:
		return database.Assignment{Column: "failed_attempts", Value: int16(0)}, nil
	default:
		return database.Assignment{}, fmt.Errorf("unknown UserPasswordChange kind %d", c.Kind())
	}
}
