package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/userrecoverycodes"
)

const createUserRecoveryCodesStmt = `INSERT INTO zitadel_nextgen.user_recovery_codes (
	id, project_id, user_id, recovery_codes
) VALUES ($1, $2, $3, $4)`

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
	if err := ensureManagedID(&codes.ID, domain.PrefixUserRecoveryCodes); err != nil {
		return err
	}
	_, err := s.client.Exec(ctx, createUserRecoveryCodesStmt,
		codes.ID,
		codes.ProjectID,
		codes.UserID,
		append([]string(nil), codes.RecoveryCodes...),
	)
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
		return nil, wrapError(pgx.ErrNoRows)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(pgx.ErrTooManyRows)
	}
}

// ListUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) ListUserRecoveryCodes(ctx context.Context, filter *database.ListOptions[domain.UserRecoveryCodesField]) (*database.ListResult[*domain.UserRecoveryCodes], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userRecoveryCodesQuery, filter, userrecoverycodes.Schema); err != nil {
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
		nextCursor = pagination.New(filter.Pagination.OrderBy, userrecoverycodes.Schema.ValuesFrom(items[len(items)-1], filter.Pagination.OrderBy.Columns)).Marshal()
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
			writeAssign("recovery_codes", append([]string(nil), u.Codes...))
		case *domain.UserRecoveryCodesLastSuccessfulCheckUpdate:
			writeAssign("last_successful_check", u.LastSuccessfulCheck)
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
	compileFilter(&c, filter, userrecoverycodes.Schema)

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
	compileFilter(&c, filter, userrecoverycodes.Schema)
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
	codes.RecoveryCodes = append([]string(nil), recoveryCodes...)
	codes.LastSuccessfulCheck = lastSuccessful
	return codes, nil
}

var _ service.UserRecoveryCodesStatements = (*userRecoveryCodesStatements)(nil)
