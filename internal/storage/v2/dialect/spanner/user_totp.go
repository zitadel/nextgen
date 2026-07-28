package spanner

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const (
	createUserTOTPStmt = `INSERT INTO user_totp (
	project_id, user_id, secret
) VALUES (@p1, @p2, @p3)`

	getUserTOTPByUserIDStmt = `SELECT id, project_id, user_id, secret, verified_at,
	last_successful_check, failed_attempts, created_at, updated_at
FROM user_totp
WHERE project_id = @p1 AND user_id = @p2`

	deleteUserTOTPByUserIDStmt = `DELETE FROM user_totp WHERE project_id = @p1 AND user_id = @p2`
)

type userTOTPStatements struct{ statement }

func newUserTOTPStatements(db queryExecutor) userTOTPStatements {
	return userTOTPStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateUserTOTP implements [service.UserTOTPStatements].
func (us userTOTPStatements) CreateUserTOTP(ctx context.Context, totp *domain.CreateUserTOTP) error {
	_, err := us.db.Update(ctx, buildStatement(createUserTOTPStmt,
		totp.ProjectID,
		totp.UserID,
		totp.Secret,
	).statement())
	return wrapError(err)
}

// GetUserTOTPByUserID implements [service.UserTOTPStatements].
func (us userTOTPStatements) GetUserTOTPByUserID(ctx context.Context, projectID, userID string) (*domain.UserTOTP, error) {
	var totp *domain.UserTOTP
	err := us.db.Query(ctx, buildStatement(getUserTOTPByUserIDStmt, projectID, userID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		totp, err = collectOneRow(iter, scanUserTOTP)
		return err
	})
	return totp, err
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
	c.WriteString("UPDATE user_totp SET ")
	writeUserTOTPPatch(&c, patch)
	c.WriteString(", updated_at = CURRENT_TIMESTAMP() WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND user_id = ")
	c.WriteArg(userID)

	n, err := us.db.Update(ctx, c.statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return wrapError(spanner.ErrRowNotFound)
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
		writeAssign("failed_attempts", int64(0))
	case patch.delta > 0:
		c.WriteString(sep)
		c.WriteString("failed_attempts = failed_attempts + ")
		c.WriteArg(int64(patch.delta))
	}
}

// DeleteUserTOTPByUserID implements [service.UserTOTPStatements].
func (us userTOTPStatements) DeleteUserTOTPByUserID(ctx context.Context, projectID, userID string) error {
	_, err := us.db.Update(ctx, buildStatement(deleteUserTOTPByUserIDStmt, projectID, userID).statement())
	return wrapError(err)
}

func scanUserTOTP(row *spanner.Row) (*domain.UserTOTP, error) {
	totp := new(domain.UserTOTP)
	var (
		verifiedAt          spanner.NullTime
		lastSuccessfulCheck spanner.NullTime
		failedAttempts      int64
	)
	if err := row.Columns(
		&totp.ID,
		&totp.ProjectID,
		&totp.UserID,
		&totp.Secret,
		&verifiedAt,
		&lastSuccessfulCheck,
		&failedAttempts,
		&totp.CreatedAt,
		&totp.UpdatedAt,
	); err != nil {
		return nil, err
	}
	totp.Secret = append([]byte(nil), totp.Secret...)
	totp.FailedAttempts = int16(failedAttempts)
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
