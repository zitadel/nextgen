package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/userpassword"
)

const (
	setUserPasswordStmt = `INSERT INTO user_passwords (
	project_id, id, user_id, encoded_hash, change_required, verification_id, changed_at, failed_attempts, last_successful_check, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
ON CONFLICT (project_id, user_id) DO UPDATE SET
	encoded_hash = EXCLUDED.encoded_hash,
	change_required = EXCLUDED.change_required,
	verification_id = EXCLUDED.verification_id,
	changed_at = EXCLUDED.changed_at,
	failed_attempts = 0,
	last_successful_check = NULL,
	updated_at = EXCLUDED.updated_at
RETURNING id`

	userPasswordQuery = `SELECT id, project_id, user_id, encoded_hash, change_required,
	changed_at, verification_id, last_successful_check, failed_attempts, created_at, updated_at
FROM user_passwords`
)

type userPasswordStatements struct{ statement }

func newUserPasswordStatements(client queryExecutor) userPasswordStatements {
	return userPasswordStatements{statement: statement{client: client}}
}

// SetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error {
	if err := ensureManagedID(&pw.ID, domain.PrefixUserPassword); err != nil {
		return err
	}
	now := nowUnixNano()
	err := ps.client.QueryRow(ctx, setUserPasswordStmt,
		pw.ProjectID,
		pw.ID,
		pw.UserID,
		pw.EncodedHash,
		pw.ChangeRequired,
		verificationIDArg(pw.VerificationID),
		now,
		now,
		now,
	).Scan(&pw.ID)
	return wrapError(err)
}

// GetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField]) (*domain.UserPassword, error) {
	result, err := ps.ListUserPasswords(ctx, &database.ListOptions[domain.UserPasswordField]{Filter: filter})
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

// ListUserPasswords implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ListUserPasswords(ctx context.Context, filter *database.ListOptions[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasswordQuery, filter, userpassword.Schema); err != nil {
		return nil, err
	}
	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	passwords, err := collectRows(rows, scanUserPassword)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		passwords,
		userpassword.Schema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.UserPassword]{Items: passwords, NextCursor: nextCursor}, nil
}

// UpdateUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) UpdateUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField], updates ...domain.UserPasswordUpdate) error {
	if filter == nil {
		return fmt.Errorf("UserPassword filter is required")
	}
	if len(updates) == 0 {
		return database.ErrNoChanges
	}

	var c statementCompiler
	c.WriteString("UPDATE user_passwords SET ")
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
		case *domain.UserPasswordEncodedHashUpdate:
			writeAssign("encoded_hash", u.EncodedHash)
		case *domain.UserPasswordChangeRequiredUpdate:
			writeAssign("change_required", u.ChangeRequired)
		case *domain.UserPasswordChangedAtUpdate:
			writeAssign("changed_at", u.ChangedAt)
		case *domain.UserPasswordVerificationIDUpdate:
			writeAssign("verification_id", u.VerificationID)
		case *domain.UserPasswordLastSuccessfulCheckUpdate:
			writeAssign("last_successful_check", u.LastSuccessfulCheck)
		case *domain.UserPasswordIncrementFailedAttemptsUpdate:
			c.WriteString(sep)
			sep = ", "
			c.WriteString("failed_attempts = failed_attempts + ")
			c.WriteArg(int64(u.Delta))
		case *domain.UserPasswordResetFailedAttemptsUpdate:
			writeAssign("failed_attempts", int64(0))
		default:
			return fmt.Errorf("unknown UserPasswordUpdate %T", update)
		}
	}

	c.WriteString(", updated_at = ")
	c.WriteArg(nowUnixNano())
	c.WriteString(" WHERE ")
	compileFilter(&c, filter, userpassword.Schema)

	n, err := execAffected(ctx, ps.client, c.String(), c.args...)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) DeleteUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField]) error {
	if filter == nil {
		return fmt.Errorf("UserPassword filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM user_passwords WHERE ")
	compileFilter(&c, filter, userpassword.Schema)
	_, err := ps.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

func scanUserPassword(rows *sql.Rows) (*domain.UserPassword, error) {
	pw := new(domain.UserPassword)
	var (
		verificationID       sql.NullString
		lastSuccessNano      sql.NullInt64
		changedNano          int64
		createdNano, updNano int64
		failedAttempts       int64
	)
	if err := rows.Scan(
		&pw.ID,
		&pw.ProjectID,
		&pw.UserID,
		&pw.EncodedHash,
		&pw.ChangeRequired,
		&changedNano,
		&verificationID,
		&lastSuccessNano,
		&failedAttempts,
		&createdNano,
		&updNano,
	); err != nil {
		return nil, err
	}
	pw.ChangedAt = timeFromUnixNano(changedNano)
	pw.CreatedAt = timeFromUnixNano(createdNano)
	pw.UpdatedAt = timeFromUnixNano(updNano)
	if verificationID.Valid {
		pw.VerificationID = &verificationID.String
	}
	if lastSuccessNano.Valid {
		t := timeFromUnixNano(lastSuccessNano.Int64)
		pw.LastSuccessfulCheck = &t
	}
	pw.FailedAttempts = int16(failedAttempts)
	return pw, nil
}

func verificationIDArg(id *string) any {
	if id == nil {
		return nil
	}
	return *id
}

var _ service.UserPasswordStatements = (*userPasswordStatements)(nil)
