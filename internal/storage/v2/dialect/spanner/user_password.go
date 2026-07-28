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
	setUserPasswordStmt = `INSERT INTO user_passwords (
	project_id, user_id, encoded_hash, change_required, verification_id
) VALUES (@p1, @p2, @p3, @p4, @p5)
ON CONFLICT (project_id, user_id) DO UPDATE SET
	encoded_hash = EXCLUDED.encoded_hash,
	change_required = EXCLUDED.change_required,
	verification_id = EXCLUDED.verification_id,
	changed_at = CURRENT_TIMESTAMP(),
	failed_attempts = 0,
	last_successful_check = NULL,
	updated_at = CURRENT_TIMESTAMP()`

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
	_, err := ps.db.Update(ctx, buildStatement(setUserPasswordStmt,
		pw.ProjectID,
		pw.UserID,
		pw.EncodedHash,
		pw.ChangeRequired,
		verificationIDArg(pw.VerificationID),
	).statement())
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
		return nil, wrapError(spanner.ErrRowNotFound)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(errTooManyRows)
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

	c.WriteString(", updated_at = CURRENT_TIMESTAMP() WHERE ")
	compileFilter(&c, filter, userPasswordSchema)

	n, err := ps.db.Update(ctx, c.statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return wrapError(spanner.ErrRowNotFound)
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
	compileFilter(&c, filter, userPasswordSchema)
	_, err := ps.db.Update(ctx, c.statement())
	return wrapError(err)
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
