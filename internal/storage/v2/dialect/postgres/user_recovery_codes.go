package postgres

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/userrecoverycodes"
)

const createUserRecoveryCodesStmt = `INSERT INTO zitadel_nextgen.user_recovery_codes (
	project_id, user_id, recovery_codes
) VALUES ($1, $2, $3)`

const deleteUserRecoveryCodesByIDStmt = `DELETE FROM zitadel_nextgen.user_recovery_codes WHERE id = $1`

const deleteUserRecoveryCodesByUserIDStmt = `DELETE FROM zitadel_nextgen.user_recovery_codes WHERE project_id = $1 AND user_id = $2`

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
	recoveryCodes := codes.RecoveryCodes
	if recoveryCodes == nil {
		recoveryCodes = []string{}
	}
	_, err := s.client.Exec(ctx, createUserRecoveryCodesStmt, codes.ProjectID, codes.UserID, recoveryCodes)
	return wrapError(err)
}

// DeleteUserRecoveryCodesByID implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) DeleteUserRecoveryCodesByID(ctx context.Context, id int64) error {
	_, err := s.client.Exec(ctx, deleteUserRecoveryCodesByIDStmt, id)
	return wrapError(err)
}

// DeleteUserRecoveryCodesByUserID implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) DeleteUserRecoveryCodesByUserID(ctx context.Context, projectID, userID string) error {
	_, err := s.client.Exec(ctx, deleteUserRecoveryCodesByUserIDStmt, projectID, userID)
	return wrapError(err)
}

// UpdateUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) UpdateUserRecoveryCodes(ctx context.Context, projectID, userID string, changes ...domain.UserRecoveryCodesChange) error {
	assignments, err := userrecoverycodes.Assignments(changes)
	if err != nil {
		return err
	}
	setClause, setArgs, next, err := database.BuildSetClause(assignments, 1)
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("UPDATE zitadel_nextgen.user_recovery_codes SET ")
	b.WriteString(setClause)
	b.WriteString(", updated_at = NOW() WHERE project_id = $")
	b.WriteString(strconv.Itoa(next))
	b.WriteString(" AND user_id = $")
	b.WriteString(strconv.Itoa(next + 1))
	args := append(setArgs, projectID, userID)
	tag, err := s.client.Exec(ctx, b.String(), args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

// GetUserRecoveryCodesByID implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) GetUserRecoveryCodesByID(ctx context.Context, id int64) (*domain.UserRecoveryCodes, error) {
	return s.getUserRecoveryCodes(ctx, &database.ListOptions[domain.UserRecoveryCodesField]{
		Filter: database.Equal(database.Col(domain.UserRecoveryCodesFieldID), id),
	})
}

// GetUserRecoveryCodesByUserID implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) GetUserRecoveryCodesByUserID(ctx context.Context, projectID, userID string) (*domain.UserRecoveryCodes, error) {
	return s.getUserRecoveryCodes(ctx, &database.ListOptions[domain.UserRecoveryCodesField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserRecoveryCodesFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserRecoveryCodesFieldUserID), userID),
		),
	})
}

func (s userRecoveryCodesStatements) getUserRecoveryCodes(ctx context.Context, filter *database.ListOptions[domain.UserRecoveryCodesField]) (*domain.UserRecoveryCodes, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userRecoveryCodesQuery, filter, userRecoveryCodesSchema); err != nil {
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
