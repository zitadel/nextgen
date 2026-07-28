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
	updateUserPasswordStmt = `UPDATE user_passwords SET
	encoded_hash = @p3,
	change_required = @p4,
	verification_id = @p5,
	changed_at = CURRENT_TIMESTAMP(),
	failed_attempts = 0,
	last_successful_check = NULL,
	updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p1 AND user_id = @p2`

	insertUserPasswordStmt = `INSERT INTO user_passwords (
	project_id, user_id, encoded_hash, change_required, verification_id
) VALUES (@p1, @p2, @p3, @p4, @p5)`

	getUserPasswordByUserIDStmt = `SELECT id, project_id, user_id, encoded_hash, change_required,
	changed_at, verification_id, last_successful_check, failed_attempts, created_at, updated_at
FROM user_passwords
WHERE project_id = @p1 AND user_id = @p2`

	deleteUserPasswordByUserIDStmt = `DELETE FROM user_passwords WHERE project_id = @p1 AND user_id = @p2`

	userPasswordQuery = `SELECT id, project_id, user_id, encoded_hash, change_required,
	changed_at, verification_id, last_successful_check, failed_attempts, created_at, updated_at
FROM user_passwords`
)

type userPasswordStatements struct{ statement }

func newUserPasswordStatements(db queryExecutor) userPasswordStatements {
	return userPasswordStatements{
		statement: statement{
			db: db,
		},
	}
}

// SetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error {
	return withTransaction(ctx, ps.db, func(ctx context.Context, tx queryExecutor) error {
		n, err := tx.Update(ctx, buildStatement(updateUserPasswordStmt,
			pw.ProjectID,
			pw.UserID,
			pw.EncodedHash,
			pw.ChangeRequired,
			verificationIDArg(pw.VerificationID),
		).statement())
		if err != nil {
			return wrapError(err)
		}
		if n > 0 {
			return nil
		}
		_, err = tx.Update(ctx, buildStatement(insertUserPasswordStmt,
			pw.ProjectID,
			pw.UserID,
			pw.EncodedHash,
			pw.ChangeRequired,
			verificationIDArg(pw.VerificationID),
		).statement())
		return wrapError(err)
	})
}

// GetUserPasswordByUserID implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordByUserID(ctx context.Context, projectID, userID string) (*domain.UserPassword, error) {
	stmt := buildStatement(getUserPasswordByUserIDStmt, projectID, userID).statement()
	var pw *domain.UserPassword
	err := ps.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		pw, err = collectOneRow(iter, ps.scanUserPassword)
		return err
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return pw, nil
}

// DeleteUserPasswordByUserID implements [service.UserPasswordStatements].
func (ps userPasswordStatements) DeleteUserPasswordByUserID(ctx context.Context, projectID, userID string) error {
	_, err := ps.db.Update(ctx, buildStatement(deleteUserPasswordByUserIDStmt, projectID, userID).statement())
	return wrapError(err)
}

type userPasswordPatch struct {
	encodedHash         *string
	changeRequired      *bool
	changedAt           *time.Time
	verificationID      *string
	lastSuccessfulCheck *time.Time
	delta               int16
	resetFailedAttempts bool
}

func coalesceUserPasswordUpdates(updates []domain.UserPasswordUpdate) (userPasswordPatch, error) {
	var patch userPasswordPatch
	for _, u := range updates {
		switch v := u.(type) {
		case *domain.UserPasswordEncodedHashUpdate:
			h := v.EncodedHash
			patch.encodedHash = &h
		case *domain.UserPasswordChangeRequiredUpdate:
			b := v.ChangeRequired
			patch.changeRequired = &b
		case *domain.UserPasswordChangedAtUpdate:
			t := v.ChangedAt
			patch.changedAt = &t
		case *domain.UserPasswordVerificationIDUpdate:
			id := v.VerificationID
			patch.verificationID = &id
		case *domain.UserPasswordLastSuccessfulCheckUpdate:
			t := v.LastSuccessfulCheck
			patch.lastSuccessfulCheck = &t
		case *domain.UserPasswordIncrementFailedAttemptsUpdate:
			if v.Delta <= 0 {
				return userPasswordPatch{}, fmt.Errorf("UserPasswordIncrementFailedAttemptsUpdate.Delta must be > 0, got %d", v.Delta)
			}
			patch.resetFailedAttempts = false
			patch.delta += v.Delta
		case *domain.UserPasswordResetFailedAttemptsUpdate:
			patch.resetFailedAttempts = true
			patch.delta = 0
		default:
			return userPasswordPatch{}, fmt.Errorf("unknown UserPasswordUpdate %T", u)
		}
	}
	return patch, nil
}

func (p userPasswordPatch) empty() bool {
	return p.encodedHash == nil &&
		p.changeRequired == nil &&
		p.changedAt == nil &&
		p.verificationID == nil &&
		p.lastSuccessfulCheck == nil &&
		!p.resetFailedAttempts &&
		p.delta == 0
}

// UpdateUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) UpdateUserPassword(ctx context.Context, projectID, userID string, updates ...domain.UserPasswordUpdate) error {
	if len(updates) == 0 {
		return database.ErrNoChanges
	}
	patch, err := coalesceUserPasswordUpdates(updates)
	if err != nil {
		return err
	}
	if patch.empty() {
		return database.ErrNoChanges
	}

	var c statementCompiler
	c.WriteString("UPDATE user_passwords SET ")
	writeUserPasswordPatch(&c, patch)
	c.WriteString(", updated_at = CURRENT_TIMESTAMP() WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND user_id = ")
	c.WriteArg(userID)

	n, err := ps.db.Update(ctx, c.statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return wrapError(spanner.ErrRowNotFound)
	}
	return nil
}

func writeUserPasswordPatch(c *statementCompiler, patch userPasswordPatch) {
	sep := ""
	writeAssign := func(col string, arg any) {
		c.WriteString(sep)
		sep = ", "
		c.WriteString(col)
		c.WriteString(" = ")
		c.WriteArg(arg)
	}
	if patch.encodedHash != nil {
		writeAssign("encoded_hash", *patch.encodedHash)
	}
	if patch.changeRequired != nil {
		writeAssign("change_required", *patch.changeRequired)
	}
	if patch.changedAt != nil {
		writeAssign("changed_at", *patch.changedAt)
	}
	if patch.verificationID != nil {
		writeAssign("verification_id", *patch.verificationID)
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

// ListUserPasswords implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ListUserPasswords(ctx context.Context, filter *database.ListOptions[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasswordQuery, filter, userPasswordSchema); err != nil {
		return nil, err
	}

	var passwords []*domain.UserPassword
	err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		passwords, err = collectRows(iter, ps.scanUserPassword)
		return err
	})
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(passwords) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.UserPasswordField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  userPasswordSchema.ValuesFrom(passwords[len(passwords)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.UserPassword]{
		Items:      passwords,
		NextCursor: nextCursor,
	}, nil
}

func (ps userPasswordStatements) scanUserPassword(row *spanner.Row) (*domain.UserPassword, error) {
	pw := new(domain.UserPassword)
	var (
		verificationID      spanner.NullString
		lastSuccessfulCheck spanner.NullTime
		failedAttempts      int64
	)
	if err := row.Columns(
		&pw.ID,
		&pw.ProjectID,
		&pw.UserID,
		&pw.EncodedHash,
		&pw.ChangeRequired,
		&pw.ChangedAt,
		&verificationID,
		&lastSuccessfulCheck,
		&failedAttempts,
		&pw.CreatedAt,
		&pw.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if verificationID.Valid {
		pw.VerificationID = &verificationID.StringVal
	}
	if lastSuccessfulCheck.Valid {
		ts := lastSuccessfulCheck.Time
		pw.LastSuccessfulCheck = &ts
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

var userPasswordSchema = database.NewSchema(map[domain.UserPasswordField]database.FieldBinding[domain.UserPassword]{
	domain.UserPasswordFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.UserPassword) any { return p.ID },
		Coerce:   database.CoerceNumber[int64],
	},
	domain.UserPasswordFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(p *domain.UserPassword) any { return p.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasswordFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(p *domain.UserPassword) any { return p.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasswordFieldEncodedHash: {
		SQLName:  "encoded_hash",
		Accessor: func(p *domain.UserPassword) any { return p.EncodedHash },
		Coerce:   database.CoerceString,
	},
	domain.UserPasswordFieldChangeRequired: {
		SQLName:  "change_required",
		Accessor: func(p *domain.UserPassword) any { return p.ChangeRequired },
		Coerce:   database.CoerceBool,
	},
	domain.UserPasswordFieldChangedAt: {
		SQLName:  "changed_at",
		Accessor: func(p *domain.UserPassword) any { return p.ChangedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserPasswordFieldVerificationID: {
		SQLName: "verification_id",
		Accessor: func(p *domain.UserPassword) any {
			if p.VerificationID == nil {
				return ""
			}
			return *p.VerificationID
		},
		Coerce: database.CoerceString,
	},
	domain.UserPasswordFieldLastSuccessfulCheck: {
		SQLName: "last_successful_check",
		Accessor: func(p *domain.UserPassword) any {
			if p.LastSuccessfulCheck == nil {
				return time.Time{}
			}
			return *p.LastSuccessfulCheck
		},
		Coerce: database.CoerceTime,
	},
	domain.UserPasswordFieldFailedAttempts: {
		SQLName:  "failed_attempts",
		Accessor: func(p *domain.UserPassword) any { return int64(p.FailedAttempts) },
		Coerce:   database.CoerceNumber[int64],
	},
	domain.UserPasswordFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.UserPassword) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserPasswordFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(p *domain.UserPassword) any { return p.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
