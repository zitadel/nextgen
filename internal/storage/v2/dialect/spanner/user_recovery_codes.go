package spanner

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	userRecoveryCodesTable              = "user_recovery_codes"
	createUserRecoveryCodesStmt         = `INSERT INTO user_recovery_codes (project_id, user_id, recovery_codes) VALUES (@p1, @p2, @p3)`
	deleteUserRecoveryCodesByIDStmt     = `DELETE FROM user_recovery_codes WHERE id = @p1`
	deleteUserRecoveryCodesByUserIDStmt = `DELETE FROM user_recovery_codes WHERE project_id = @p1 AND user_id = @p2`
	userRecoveryCodesQuery              = `SELECT id, project_id, user_id, recovery_codes,
	last_successful_check, failed_attempts, created_at, updated_at
FROM user_recovery_codes`
)

var userRecoveryCodesColumns = []string{
	"id", "project_id", "user_id", "recovery_codes",
	"last_successful_check", "failed_attempts", "created_at", "updated_at",
}

type userRecoveryCodesStatements struct{ statement }

func newUserRecoveryCodesStatements(db queryExecutor) userRecoveryCodesStatements {
	return userRecoveryCodesStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) CreateUserRecoveryCodes(ctx context.Context, codes *domain.CreateRecoveryCodes) error {
	if err := domain.RequireNonEmptyRecoveryCodes(codes.RecoveryCodes); err != nil {
		return err
	}
	_, err := s.db.Update(ctx, buildStatement(createUserRecoveryCodesStmt,
		codes.ProjectID,
		codes.UserID,
		codes.RecoveryCodes,
	).statement())
	return err
}

// DeleteUserRecoveryCodesByID implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) DeleteUserRecoveryCodesByID(ctx context.Context, id int64) error {
	_, err := s.db.Update(ctx, buildStatement(deleteUserRecoveryCodesByIDStmt, id).statement())
	return err
}

// DeleteUserRecoveryCodesByUserID implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) DeleteUserRecoveryCodesByUserID(ctx context.Context, projectID, userID string) error {
	_, err := s.db.Update(ctx, buildStatement(deleteUserRecoveryCodesByUserIDStmt, projectID, userID).statement())
	return err
}

// UpdateUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) UpdateUserRecoveryCodes(ctx context.Context, projectID, userID string, updates ...domain.UserRecoveryCodesUpdate) error {
	if len(updates) == 0 {
		return database.ErrNoChanges
	}

	var c statementCompiler
	c.WriteString("UPDATE user_recovery_codes SET ")
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
			c.WriteArg(int64(u.Delta))
		case *domain.UserRecoveryCodesResetFailedAttemptsUpdate:
			writeAssign("failed_attempts", int64(0))
		default:
			return fmt.Errorf("unknown UserRecoveryCodesUpdate %T", update)
		}
	}

	c.WriteString(", updated_at = CURRENT_TIMESTAMP() WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND user_id = ")
	c.WriteArg(userID)

	n, err := s.db.Update(ctx, c.statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return wrapError(spanner.ErrRowNotFound)
	}
	return nil
}

// GetUserRecoveryCodesByID implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) GetUserRecoveryCodesByID(ctx context.Context, id int64) (*domain.UserRecoveryCodes, error) {
	row, err := s.db.ReadRow(ctx, userRecoveryCodesTable, spanner.Key{id}, userRecoveryCodesColumns)
	if err != nil {
		return nil, err
	}
	return s.scanUserRecoveryCodes(row)
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

	var codes *domain.UserRecoveryCodes
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		codes, err = collectOneRow(iter, s.scanUserRecoveryCodes)
		return err
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// ListUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) ListUserRecoveryCodes(ctx context.Context, filter *database.ListOptions[domain.UserRecoveryCodesField]) (*database.ListResult[*domain.UserRecoveryCodes], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userRecoveryCodesQuery, filter, userRecoveryCodesSchema); err != nil {
		return nil, err
	}

	var items []*domain.UserRecoveryCodes
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, s.scanUserRecoveryCodes)
		return err
	})
	if err != nil {
		return nil, err
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

func (s userRecoveryCodesStatements) scanUserRecoveryCodes(row *spanner.Row) (*domain.UserRecoveryCodes, error) {
	codes := new(domain.UserRecoveryCodes)
	var (
		recoveryCodes  []string
		lastSuccessful spanner.NullTime
		failedAttempts int64
	)
	if err := row.Columns(
		&codes.ID,
		&codes.ProjectID,
		&codes.UserID,
		&recoveryCodes,
		&lastSuccessful,
		&failedAttempts,
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
	if lastSuccessful.Valid {
		ts := lastSuccessful.Time
		codes.LastSuccessfulCheck = &ts
	}
	codes.FailedAttempts = int16(failedAttempts)
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
