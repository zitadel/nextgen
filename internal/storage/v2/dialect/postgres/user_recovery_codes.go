package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const createUserRecoveryCodesStmt = `INSERT INTO zitadel_nextgen.user_recovery_codes (
	project_id, user_id, recovery_codes
) VALUES ($1, $2, $3)`

const userRecoveryCodesQuery = `SELECT id, project_id, user_id, recovery_codes,
	last_successful_check, failed_attempts, created_at, updated_at
FROM zitadel_nextgen.user_recovery_codes`

type userRecoveryCodesStatements struct{ statement }

func newUserRecoveryCodesStatements(client queryExecutor) userRecoveryCodesStatements {
	return userRecoveryCodesStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) CreateUserRecoveryCodes(ctx context.Context, codes *domain.CreateRecoveryCodes) error {
	if err := domain.RequireNonEmptyRecoveryCodes(codes.RecoveryCodes); err != nil {
		return err
	}
	_, err := s.client.Exec(ctx, createUserRecoveryCodesStmt, codes.ProjectID, codes.UserID, codes.RecoveryCodes)
	return wrapError(err)
}

// GetUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) GetUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField]) (*domain.UserRecoveryCodes, error) {
	if filter == nil {
		return nil, fmt.Errorf("UserRecoveryCodes filter is required")
	}
	var compiler statementCompiler
	if err := compileRead(&compiler, userRecoveryCodesQuery, &database.ListOptions[domain.UserRecoveryCodesField]{Filter: filter}, userRecoveryCodesSchema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	codes, err := pgx.CollectExactlyOneRow(rows, s.scanUserRecoveryCodes)
	if err != nil {
		return nil, wrapError(err)
	}
	return codes, nil
}

// ListUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) ListUserRecoveryCodes(ctx context.Context, filter *database.ListOptions[domain.UserRecoveryCodesField]) (*database.ListResult[*domain.UserRecoveryCodes], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userRecoveryCodesQuery, filter, userRecoveryCodesSchema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	items, err := pgx.CollectRows(rows, s.scanUserRecoveryCodes)
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(items) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.UserRecoveryCodesField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  userRecoveryCodesSchema.ValuesFrom(items[len(items)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.UserRecoveryCodes]{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

// UpdateUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) UpdateUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField], updates ...domain.UserRecoveryCodesUpdate) error {
	if filter == nil {
		return fmt.Errorf("UserRecoveryCodes filter is required")
	}
	if len(updates) == 0 {
		return database.ErrNoChanges
	}

	var c statementCompiler
	c.WriteString("UPDATE zitadel_nextgen.user_recovery_codes SET ")
	sep := ""
	writeAssign := func(col string, arg any) {
		c.WriteString(sep)
		sep = ", "
		c.WriteString(col)
		c.WriteString(" = ")
		c.WriteArg(arg)
	}

	for _, update := range updates {
		switch u := update.(type) {
		case *domain.UserRecoveryCodesCodesUpdate:
			if err := domain.RequireNonEmptyRecoveryCodes(u.Codes); err != nil {
				return err
			}
			writeAssign("recovery_codes", u.Codes)
		case *domain.UserRecoveryCodesLastSuccessfulCheckUpdate:
			c.WriteString(sep)
			sep = ", "
			c.WriteString("last_successful_check = ")
			if u.LastSuccessfulCheck == nil {
				c.WriteString("NULL")
			} else {
				c.WriteArg(*u.LastSuccessfulCheck)
			}
		case *domain.UserRecoveryCodesIncrementFailedAttemptsUpdate:
			c.WriteString(sep)
			sep = ", "
			c.WriteString("failed_attempts = failed_attempts + ")
			c.WriteArg(u.Delta)
		case *domain.UserRecoveryCodesResetFailedAttemptsUpdate:
			writeAssign("failed_attempts", int16(0))
		default:
			return fmt.Errorf("unknown UserRecoveryCodesUpdate %T", update)
		}
	}

	c.WriteString(", updated_at = NOW() WHERE ")
	compileFilter(&c, filter, userRecoveryCodesSchema)

	tag, err := s.client.Exec(ctx, c.String(), c.args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

// DeleteUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) DeleteUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField]) error {
	if filter == nil {
		return fmt.Errorf("UserRecoveryCodes filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM zitadel_nextgen.user_recovery_codes WHERE ")
	compileFilter(&c, filter, userRecoveryCodesSchema)
	_, err := s.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

func (s userRecoveryCodesStatements) scanUserRecoveryCodes(row pgx.CollectableRow) (*domain.UserRecoveryCodes, error) {
	codes := new(domain.UserRecoveryCodes)
	var (
		recoveryCodes  []string
		lastSuccessful *time.Time
	)
	if err := row.Scan(
		&codes.ID,
		&codes.ProjectID,
		&codes.UserID,
		&recoveryCodes,
		&lastSuccessful,
		&codes.FailedAttempts,
		&codes.CreatedAt,
		&codes.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if recoveryCodes == nil {
		codes.RecoveryCodes = []string{}
	} else {
		codes.RecoveryCodes = append([]string(nil), recoveryCodes...)
	}
	codes.LastSuccessfulCheck = lastSuccessful
	return codes, nil
}

var _ service.UserRecoveryCodesStatements = (*userRecoveryCodesStatements)(nil)

var userRecoveryCodesSchema = database.NewSchema(map[domain.UserRecoveryCodesField]database.FieldBinding[domain.UserRecoveryCodes]{
	domain.UserRecoveryCodesFieldID: {
		SQLName:  "id",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.ID },
		Coerce:   database.CoerceNumber[int64],
	},
	domain.UserRecoveryCodesFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserRecoveryCodesFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserRecoveryCodesFieldRecoveryCodes: {
		SQLName:  "recovery_codes",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.RecoveryCodes },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
	domain.UserRecoveryCodesFieldLastSuccessfulCheck: {
		SQLName: "last_successful_check",
		Accessor: func(c *domain.UserRecoveryCodes) any {
			if c.LastSuccessfulCheck == nil {
				return time.Time{}
			}
			return *c.LastSuccessfulCheck
		},
		Coerce: database.CoerceTime,
	},
	domain.UserRecoveryCodesFieldFailedAttempts: {
		SQLName:  "failed_attempts",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.FailedAttempts },
		Coerce:   database.CoerceNumber[int16],
	},
	domain.UserRecoveryCodesFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserRecoveryCodesFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(c *domain.UserRecoveryCodes) any { return c.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
