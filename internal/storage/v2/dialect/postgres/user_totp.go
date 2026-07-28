package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const createUserTOTPStmt = `INSERT INTO zitadel_nextgen.user_totp (
	project_id, user_id, secret
) VALUES ($1, $2, $3)`

const getUserTOTPByUserIDStmt = `SELECT id, project_id, user_id, secret, verified_at,
	last_successful_check, failed_attempts, created_at, updated_at
FROM zitadel_nextgen.user_totp
WHERE project_id = $1 AND user_id = $2`

const deleteUserTOTPByUserIDStmt = `DELETE FROM zitadel_nextgen.user_totp WHERE project_id = $1 AND user_id = $2`

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
	_, err := us.client.Exec(ctx, createUserTOTPStmt, totp.ProjectID, totp.UserID, totp.Secret)
	return wrapError(err)
}

// GetUserTOTPByUserID implements [service.UserTOTPStatements].
func (us userTOTPStatements) GetUserTOTPByUserID(ctx context.Context, projectID, userID string) (*domain.UserTOTP, error) {
	totp := new(domain.UserTOTP)
	var (
		verifiedAt          sql.NullTime
		lastSuccessfulCheck sql.NullTime
	)
	err := us.client.QueryRow(ctx, getUserTOTPByUserIDStmt, projectID, userID).Scan(
		&totp.ID,
		&totp.ProjectID,
		&totp.UserID,
		&totp.Secret,
		&verifiedAt,
		&lastSuccessfulCheck,
		&totp.FailedAttempts,
		&totp.CreatedAt,
		&totp.UpdatedAt,
	)
	if err != nil {
		return nil, wrapError(err)
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

type userTOTPPatch struct {
	secret              *[]byte
	verifiedAt          *time.Time
	lastSuccessfulCheck *time.Time
	delta               int16
	resetFailedAttempts bool
}

func coalesceUserTOTPUpdates(updates []domain.UserTOTPUpdate) (userTOTPPatch, error) {
	var patch userTOTPPatch
	for _, u := range updates {
		switch v := u.(type) {
		case *domain.UserTOTPSecretUpdate:
			s := append([]byte(nil), v.Secret...)
			patch.secret = &s
		case *domain.UserTOTPVerifiedAtUpdate:
			t := v.VerifiedAt
			patch.verifiedAt = &t
		case *domain.UserTOTPLastSuccessfulCheckUpdate:
			t := v.LastSuccessfulCheck
			patch.lastSuccessfulCheck = &t
		case *domain.UserTOTPIncrementFailedAttemptsUpdate:
			if v.Delta <= 0 {
				return userTOTPPatch{}, fmt.Errorf("UserTOTPIncrementFailedAttemptsUpdate.Delta must be > 0, got %d", v.Delta)
			}
			patch.resetFailedAttempts = false
			patch.delta += v.Delta
		case *domain.UserTOTPResetFailedAttemptsUpdate:
			patch.resetFailedAttempts = true
			patch.delta = 0
		default:
			return userTOTPPatch{}, fmt.Errorf("unknown UserTOTPUpdate %T", u)
		}
	}
	return patch, nil
}

func (p userTOTPPatch) empty() bool {
	return p.secret == nil &&
		p.verifiedAt == nil &&
		p.lastSuccessfulCheck == nil &&
		!p.resetFailedAttempts &&
		p.delta == 0
}

// UpdateUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) UpdateUserTOTP(ctx context.Context, projectID, userID string, updates ...domain.UserTOTPUpdate) error {
	if len(updates) == 0 {
		return database.ErrNoChanges
	}
	patch, err := coalesceUserTOTPUpdates(updates)
	if err != nil {
		return err
	}
	if patch.empty() {
		return database.ErrNoChanges
	}

	var c statementCompiler
	c.WriteString("UPDATE zitadel_nextgen.user_totp SET ")
	writeUserTOTPPatch(&c, patch)
	c.WriteString(", updated_at = NOW() WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND user_id = ")
	c.WriteArg(userID)

	tag, err := us.client.Exec(ctx, c.String(), c.args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

func writeUserTOTPPatch(c *statementCompiler, patch userTOTPPatch) {
	sep := ""
	writeAssign := func(col string, arg any) {
		c.WriteString(sep)
		sep = ", "
		c.WriteString(col)
		c.WriteString(" = ")
		c.WriteArg(arg)
	}
	if patch.secret != nil {
		writeAssign("secret", *patch.secret)
	}
	if patch.verifiedAt != nil {
		writeAssign("verified_at", *patch.verifiedAt)
	}
	if patch.lastSuccessfulCheck != nil {
		writeAssign("last_successful_check", *patch.lastSuccessfulCheck)
	}
	switch {
	case patch.resetFailedAttempts:
		writeAssign("failed_attempts", int16(0))
	case patch.delta > 0:
		c.WriteString(sep)
		c.WriteString("failed_attempts = failed_attempts + ")
		c.WriteArg(patch.delta)
	}
}

// DeleteUserTOTPByUserID implements [service.UserTOTPStatements].
func (us userTOTPStatements) DeleteUserTOTPByUserID(ctx context.Context, projectID, userID string) error {
	_, err := us.client.Exec(ctx, deleteUserTOTPByUserIDStmt, projectID, userID)
	return wrapError(err)
}

var _ service.UserTOTPStatements = (*userTOTPStatements)(nil)
