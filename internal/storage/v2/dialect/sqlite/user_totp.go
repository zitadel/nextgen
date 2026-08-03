package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/usertotp"
)

const (
	createUserTOTPStmt = `INSERT INTO user_totp (
	project_id, id, user_id, secret, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?)`

	userTOTPQuery = `SELECT id, project_id, user_id, secret, verified_at,
	last_successful_check, failed_attempts, created_at, updated_at
FROM user_totp`
)

type userTOTPStatements struct{ statement }

func newUserTOTPStatements(client queryExecutor) userTOTPStatements {
	return userTOTPStatements{statement: statement{client: client}}
}

// CreateUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) CreateUserTOTP(ctx context.Context, totp *domain.CreateUserTOTP) error {
	if err := ensureManagedID(&totp.ID, domain.PrefixUserTOTP); err != nil {
		return err
	}
	now := nowUnixNano()
	_, err := us.client.Exec(ctx, createUserTOTPStmt,
		totp.ProjectID,
		totp.ID,
		totp.UserID,
		append([]byte(nil), totp.Secret...),
		now,
		now,
	)
	return wrapError(err)
}

// GetUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) GetUserTOTP(ctx context.Context, filter database.Filter[domain.UserTOTPField]) (*domain.UserTOTP, error) {
	result, err := us.ListUserTOTPs(ctx, &database.ListOptions[domain.UserTOTPField]{Filter: filter})
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

// ListUserTOTPs implements [service.UserTOTPStatements].
func (us userTOTPStatements) ListUserTOTPs(ctx context.Context, filter *database.ListOptions[domain.UserTOTPField]) (*database.ListResult[*domain.UserTOTP], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userTOTPQuery, filter, usertotp.Schema); err != nil {
		return nil, err
	}
	rows, err := us.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, scanUserTOTP)
	if err != nil {
		return nil, wrapError(err)
	}
	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(items) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.UserTOTPField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  usertotp.Schema.ValuesFrom(items[len(items)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}
	return &database.ListResult[*domain.UserTOTP]{Items: items, NextCursor: nextCursor}, nil
}

// UpdateUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) UpdateUserTOTP(ctx context.Context, filter database.Filter[domain.UserTOTPField], updates ...domain.UserTOTPUpdate) error {
	if filter == nil {
		return fmt.Errorf("UserTOTP filter is required")
	}
	if len(updates) == 0 {
		return database.ErrNoChanges
	}

	var c statementCompiler
	c.WriteString("UPDATE user_totp SET ")
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
		case *domain.UserTOTPSecretUpdate:
			writeAssign("secret", append([]byte(nil), u.Secret...))
		case *domain.UserTOTPVerifiedAtUpdate:
			writeAssign("verified_at", u.VerifiedAt)
		case *domain.UserTOTPLastSuccessfulCheckUpdate:
			writeAssign("last_successful_check", u.LastSuccessfulCheck)
		case *domain.UserTOTPIncrementFailedAttemptsUpdate:
			c.WriteString(sep)
			sep = ", "
			c.WriteString("failed_attempts = failed_attempts + ")
			c.WriteArg(int64(u.Delta))
		case *domain.UserTOTPResetFailedAttemptsUpdate:
			writeAssign("failed_attempts", int64(0))
		default:
			return fmt.Errorf("unknown UserTOTPUpdate %T", update)
		}
	}

	c.WriteString(", updated_at = ")
	c.WriteArg(nowUnixNano())
	c.WriteString(" WHERE ")
	compileFilter(&c, filter, usertotp.Schema)

	n, err := execAffected(ctx, us.client, c.String(), c.args...)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) DeleteUserTOTP(ctx context.Context, filter database.Filter[domain.UserTOTPField]) error {
	if filter == nil {
		return fmt.Errorf("UserTOTP filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM user_totp WHERE ")
	compileFilter(&c, filter, usertotp.Schema)
	_, err := us.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

func scanUserTOTP(rows *sql.Rows) (*domain.UserTOTP, error) {
	totp := new(domain.UserTOTP)
	var (
		verifiedNano         sql.NullInt64
		lastSuccessNano      sql.NullInt64
		failedAttempts       int64
		createdNano, updNano int64
	)
	if err := rows.Scan(
		&totp.ID,
		&totp.ProjectID,
		&totp.UserID,
		&totp.Secret,
		&verifiedNano,
		&lastSuccessNano,
		&failedAttempts,
		&createdNano,
		&updNano,
	); err != nil {
		return nil, err
	}
	totp.Secret = append([]byte(nil), totp.Secret...)
	totp.FailedAttempts = int16(failedAttempts)
	if verifiedNano.Valid {
		totp.VerifiedAt = timeFromUnixNano(verifiedNano.Int64)
	}
	if lastSuccessNano.Valid {
		t := timeFromUnixNano(lastSuccessNano.Int64)
		totp.LastSuccessfulCheck = &t
	}
	totp.CreatedAt = timeFromUnixNano(createdNano)
	totp.UpdatedAt = timeFromUnixNano(updNano)
	return totp, nil
}

var _ service.UserTOTPStatements = (*userTOTPStatements)(nil)
