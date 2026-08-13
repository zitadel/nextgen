package spanner

import (
	"context"
	"fmt"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/userrecoverycodes"
)

const (
	createUserRecoveryCodesStmt = `INSERT INTO user_recovery_codes (id, project_id, user_id, recovery_codes) VALUES (@p1, @p2, @p3, @p4)`
	userRecoveryCodesQuery      = `SELECT id, project_id, user_id, recovery_codes,
	last_successful_check, failed_attempts, created_at, updated_at
FROM user_recovery_codes`
)

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
	if err := ensureManagedID(&codes.ID, domain.PrefixUserRecoveryCodes); err != nil {
		return err
	}
	_, err := s.db.Update(ctx, buildStatement(createUserRecoveryCodesStmt,
		codes.ID,
		codes.ProjectID,
		codes.UserID,
		append([]string(nil), codes.RecoveryCodes...),
	).statement())
	return wrapError(err)
}

// GetUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) GetUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField]) (*domain.UserRecoveryCodes, error) {
	result, err := s.ListUserRecoveryCodes(ctx, &database.ListOptions[domain.UserRecoveryCodesField]{Filter: filter})
	if err != nil {
		return nil, err
	}
	switch len(result.Items) {
	case 0:
		return nil, wrapError(spanner.ErrRowNotFound)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(errTooManyRows)
	}
}

// ListUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) ListUserRecoveryCodes(ctx context.Context, filter *database.ListOptions[domain.UserRecoveryCodesField]) (*database.ListResult[*domain.UserRecoveryCodes], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userRecoveryCodesQuery, filter, userrecoverycodes.Schema); err != nil {
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

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		userrecoverycodes.Schema,
		filter.Pagination.Limit,
	)

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
			writeAssign("recovery_codes", append([]string(nil), u.Codes...))
		case *domain.UserRecoveryCodesLastSuccessfulCheckUpdate:
			writeAssign("last_successful_check", u.LastSuccessfulCheck)
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

	c.WriteString(", updated_at = CURRENT_TIMESTAMP() WHERE ")
	compileFilter(&c, filter, userrecoverycodes.Schema)

	n, err := s.db.Update(ctx, c.statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return wrapError(spanner.ErrRowNotFound)
	}
	return nil
}

// DeleteUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) DeleteUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField]) error {
	if filter == nil {
		return fmt.Errorf("UserRecoveryCodes filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM user_recovery_codes WHERE ")
	compileFilter(&c, filter, userrecoverycodes.Schema)
	_, err := s.db.Update(ctx, c.statement())
	return wrapError(err)
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
	codes.RecoveryCodes = append([]string(nil), recoveryCodes...)
	if lastSuccessful.Valid {
		ts := lastSuccessful.Time
		codes.LastSuccessfulCheck = &ts
	}
	codes.FailedAttempts = int16(failedAttempts)
	return codes, nil
}

var _ service.UserRecoveryCodesStatements = (*userRecoveryCodesStatements)(nil)
