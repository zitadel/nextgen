package userpasskey

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Assignments maps domain passkey changes to SQL column assignments.
func Assignments(changes []domain.UserPasskeyChange) ([]database.Assignment, error) {
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

func assignment(c domain.UserPasskeyChange) (database.Assignment, error) {
	switch c.Kind() {
	case domain.UserPasskeyChangeSetAttestationType:
		return database.Assignment{Column: "attestation_type", Value: c.AttestationType()}, nil
	case domain.UserPasskeyChangeSetTransports:
		transports := c.Transports()
		if transports == nil {
			transports = []string{}
		}
		return database.Assignment{Column: "transports", Value: transports}, nil
	case domain.UserPasskeyChangeSetSignCount:
		return database.Assignment{Column: "sign_count", Value: c.SignCount()}, nil
	case domain.UserPasskeyChangeIncrementSignCount:
		return database.Assignment{
			Column:   "sign_count",
			Expr:     "sign_count + ?",
			ExprArgs: []any{c.SignCount()},
		}, nil
	case domain.UserPasskeyChangeSetBackupEligible:
		return database.Assignment{Column: "backup_eligible", Value: c.Bool()}, nil
	case domain.UserPasskeyChangeSetBackupState:
		return database.Assignment{Column: "backup_state", Value: c.Bool()}, nil
	case domain.UserPasskeyChangeSetVerifiedAt:
		return database.Assignment{Column: "verified_at", Value: c.Time()}, nil
	case domain.UserPasskeyChangeSetLastUsedAt:
		return database.Assignment{Column: "last_used_at", Value: c.Time()}, nil
	default:
		return database.Assignment{}, fmt.Errorf("unknown UserPasskeyChange kind %d", c.Kind())
	}
}
