package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/userrecoverycodes"
)

const (
	createUserRecoveryCodesStmt = `INSERT INTO user_recovery_codes (project_id, id, user_id, recovery_codes, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)`

	userRecoveryCodesQuery = `SELECT id, project_id, user_id, recovery_codes,
	last_successful_check, failed_attempts, created_at, updated_at
FROM user_recovery_codes`
)

type userRecoveryCodesStatements struct{ statement }

func newUserRecoveryCodesStatements(client queryExecutor) userRecoveryCodesStatements {
	return userRecoveryCodesStatements{statement: statement{client: client}}
}

// CreateUserRecoveryCodes implements [service.UserRecoveryCodesStatements].
func (s userRecoveryCodesStatements) CreateUserRecoveryCodes(ctx context.Context, codes *domain.CreateRecoveryCodes) error {
	if err := domain.RequireNonEmptyRecoveryCodes(codes.RecoveryCodes); err != nil {
		return err
	}
	id := ""
	if err := ensureManagedID(&id, domain.PrefixUserRecoveryCodes); err != nil {
		return err
	}
	codesJSON, err := encodeJSON(append([]string(nil), codes.RecoveryCodes...))
	if err != nil {
		return wrapError(err)
	}
	now := nowUnixNano()
	_, err = s.client.Exec(ctx, createUserRecoveryCodesStmt,
		codes.ProjectID, id, codes.UserID, codesJSON, now, now,
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
		return nil, database.NewNoRowFoundError(nil)
	case 1:
		return result.Items[0], nil
	default:
		return nil, database.NewMultipleRowsFoundError(nil)
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
	defer rows.Close()
	items, err := collectRows(rows, scanUserRecoveryCodes)
	if err != nil {
		return nil, wrapError(err)
	}
	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(items) == int(filter.Pagination.Limit) {
		nextCursor = pagination.New(filter.Pagination.OrderBy, userrecoverycodes.Schema.ValuesFrom(items[len(items)-1], filter.Pagination.OrderBy.Columns)).Marshal()
	}
	return &database.ListResult[*domain.UserRecoveryCodes]{Items: items, NextCursor: nextCursor}, nil
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
			codesJSON, err := encodeJSON(append([]string(nil), u.Codes...))
			if err != nil {
				return err
			}
			writeAssign("recovery_codes", codesJSON)
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

	c.WriteString(", updated_at = ")
	c.WriteArg(nowUnixNano())
	c.WriteString(" WHERE ")
	compileFilter(&c, filter, userrecoverycodes.Schema)

	n, err := execAffected(ctx, s.client, c.String(), c.args...)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
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
	_, err := s.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

func scanUserRecoveryCodes(rows *sql.Rows) (*domain.UserRecoveryCodes, error) {
	codes := new(domain.UserRecoveryCodes)
	var (
		recoveryCodesStr     string
		lastSuccessNano      sql.NullInt64
		failedAttempts       int64
		createdNano, updNano int64
	)
	if err := rows.Scan(
		&codes.ID,
		&codes.ProjectID,
		&codes.UserID,
		&recoveryCodesStr,
		&lastSuccessNano,
		&failedAttempts,
		&createdNano,
		&updNano,
	); err != nil {
		return nil, err
	}
	rc, err := decodeJSONStrings(recoveryCodesStr)
	if err != nil {
		return nil, fmt.Errorf("decode recovery_codes: %w", err)
	}
	codes.RecoveryCodes = append([]string(nil), rc...)
	if lastSuccessNano.Valid {
		t := timeFromUnixNano(lastSuccessNano.Int64)
		codes.LastSuccessfulCheck = &t
	}
	codes.FailedAttempts = int16(failedAttempts)
	codes.CreatedAt = timeFromUnixNano(createdNano)
	codes.UpdatedAt = timeFromUnixNano(updNano)
	return codes, nil
}

var _ service.UserRecoveryCodesStatements = (*userRecoveryCodesStatements)(nil)
