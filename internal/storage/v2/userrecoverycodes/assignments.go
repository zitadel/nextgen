package userrecoverycodes

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Assignments maps domain recovery-codes changes to SQL column assignments.
func Assignments(changes []domain.UserRecoveryCodesChange) ([]database.Assignment, error) {
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

func assignment(c domain.UserRecoveryCodesChange) (database.Assignment, error) {
	switch c.Kind() {
	case domain.UserRecoveryCodesChangeSetCodes:
		return database.Assignment{Column: "recovery_codes", Value: c.Codes()}, nil
	case domain.UserRecoveryCodesChangeSetLastSuccessfulCheck:
		if c.TimePtr() == nil {
			return database.Assignment{Column: "last_successful_check", Null: true}, nil
		}
		return database.Assignment{Column: "last_successful_check", Value: *c.TimePtr()}, nil
	case domain.UserRecoveryCodesChangeIncrementFailedAttempts:
		return database.Assignment{Column: "failed_attempts", Expr: "failed_attempts + 1"}, nil
	case domain.UserRecoveryCodesChangeResetFailedAttempts:
		return database.Assignment{Column: "failed_attempts", Value: int16(0)}, nil
	default:
		return database.Assignment{}, fmt.Errorf("unknown UserRecoveryCodesChange kind %d", c.Kind())
	}
}
