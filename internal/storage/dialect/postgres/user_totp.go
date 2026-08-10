package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/usertotp"
)

const createUserTOTPStmt = `INSERT INTO zitadel_nextgen.user_totp (
	id, project_id, user_id, secret
) VALUES ($1, $2, $3, $4)`

const userTOTPQuery = `SELECT id, project_id, user_id, secret, verified_at,
	last_successful_check, failed_attempts, created_at, updated_at
FROM zitadel_nextgen.user_totp`

type userTOTPStatements struct{ statement }

func newUserTOTPStatements(client queryExecutor) userTOTPStatements {
	return userTOTPStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) CreateUserTOTP(ctx context.Context, totp *domain.CreateUserTOTP) error {
	if err := ensureManagedID(&totp.ID, domain.PrefixUserTOTP); err != nil {
		return err
	}
	_, err := us.client.Exec(ctx, createUserTOTPStmt, totp.ID, totp.ProjectID, totp.UserID, append([]byte(nil), totp.Secret...))
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
		return nil, wrapError(pgx.ErrNoRows)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(pgx.ErrTooManyRows)
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

	items, err := pgx.CollectRows(rows, us.scanUserTOTP)
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(items) == int(filter.Pagination.Limit) {
		nextCursor = pagination.New(filter.Pagination.OrderBy, usertotp.Schema.ValuesFrom(items[len(items)-1], filter.Pagination.OrderBy.Columns)).Marshal()
	}

	return &database.ListResult[*domain.UserTOTP]{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
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
	c.WriteString("UPDATE zitadel_nextgen.user_totp SET ")
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
			c.WriteArg(u.Delta)
		case *domain.UserTOTPResetFailedAttemptsUpdate:
			writeAssign("failed_attempts", int16(0))
		default:
			return fmt.Errorf("unknown UserTOTPUpdate %T", update)
		}
	}

	c.WriteString(", updated_at = NOW() WHERE ")
	compileFilter(&c, filter, usertotp.Schema)

	tag, err := us.client.Exec(ctx, c.String(), c.args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

// DeleteUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) DeleteUserTOTP(ctx context.Context, filter database.Filter[domain.UserTOTPField]) error {
	if filter == nil {
		return fmt.Errorf("UserTOTP filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM zitadel_nextgen.user_totp WHERE ")
	compileFilter(&c, filter, usertotp.Schema)
	_, err := us.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

func (us userTOTPStatements) scanUserTOTP(row pgx.CollectableRow) (*domain.UserTOTP, error) {
	totp := new(domain.UserTOTP)
	var (
		verifiedAt          sql.NullTime
		lastSuccessfulCheck sql.NullTime
	)
	if err := row.Scan(
		&totp.ID,
		&totp.ProjectID,
		&totp.UserID,
		&totp.Secret,
		&verifiedAt,
		&lastSuccessfulCheck,
		&totp.FailedAttempts,
		&totp.CreatedAt,
		&totp.UpdatedAt,
	); err != nil {
		return nil, err
	}
	totp.Secret = append([]byte(nil), totp.Secret...)
	if verifiedAt.Valid {
		totp.VerifiedAt = verifiedAt.Time
	}
	if lastSuccessfulCheck.Valid {
		t := lastSuccessfulCheck.Time
		totp.LastSuccessfulCheck = &t
	}
	return totp, nil
}

var _ service.UserTOTPStatements = (*userTOTPStatements)(nil)
