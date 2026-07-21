package postgres

import (
	"context"
	"database/sql"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const setUserPasswordStmt = `INSERT INTO zitadel_nextgen.user_passwords (
	project_id, user_id, encoded_hash, change_required, verification_id
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (project_id, user_id) DO UPDATE SET
	encoded_hash = EXCLUDED.encoded_hash,
	change_required = EXCLUDED.change_required,
	verification_id = EXCLUDED.verification_id,
	changed_at = NOW(),
	failed_attempts = 0,
	last_successful_check = NULL,
	updated_at = NOW()`

const getUserPasswordByUserIDStmt = `SELECT id, project_id, user_id, encoded_hash, change_required,
	changed_at, verification_id, last_successful_check, failed_attempts, created_at, updated_at
FROM zitadel_nextgen.user_passwords
WHERE project_id = $1 AND user_id = $2`

const deleteUserPasswordByUserIDStmt = `DELETE FROM zitadel_nextgen.user_passwords WHERE project_id = $1 AND user_id = $2`

const userPasswordQuery = `SELECT id, project_id, user_id, encoded_hash, change_required,
	changed_at, verification_id, last_successful_check, failed_attempts, created_at, updated_at
FROM zitadel_nextgen.user_passwords`

type userPasswordStatements struct{ statement }

func newUserPasswordStatements(client queryExecutor) userPasswordStatements {
	return userPasswordStatements{
		statement: statement{
			client: client,
		},
	}
}

// SetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error {
	_, err := ps.client.Exec(ctx, setUserPasswordStmt,
		pw.ProjectID,
		pw.UserID,
		pw.EncodedHash,
		pw.ChangeRequired,
		pw.VerificationID,
	)
	return wrapError(err)
}

// GetUserPasswordByUserID implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordByUserID(ctx context.Context, projectID, userID string) (*domain.UserPassword, error) {
	row := ps.client.QueryRow(ctx, getUserPasswordByUserIDStmt, projectID, userID)
	pw, err := ps.scanUserPasswordRow(row)
	if err != nil {
		return nil, wrapError(err)
	}
	return pw, nil
}

// DeleteUserPasswordByUserID implements [service.UserPasswordStatements].
func (ps userPasswordStatements) DeleteUserPasswordByUserID(ctx context.Context, projectID, userID string) error {
	_, err := ps.client.Exec(ctx, deleteUserPasswordByUserIDStmt, projectID, userID)
	return wrapError(err)
}

// ListUserPasswords implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ListUserPasswords(ctx context.Context, filter *database.ListOptions[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasswordQuery, filter, userPasswordSchema); err != nil {
		return nil, err
	}

	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	passwords, err := pgx.CollectRows(rows, ps.scanUserPassword)
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

func (ps userPasswordStatements) scanUserPassword(row pgx.CollectableRow) (*domain.UserPassword, error) {
	return ps.scanUserPasswordRow(row)
}

type scannable interface {
	Scan(dest ...any) error
}

func (ps userPasswordStatements) scanUserPasswordRow(row scannable) (*domain.UserPassword, error) {
	pw := new(domain.UserPassword)
	var (
		verificationID      sql.NullString
		lastSuccessfulCheck sql.NullTime
	)
	if err := row.Scan(
		&pw.ID,
		&pw.ProjectID,
		&pw.UserID,
		&pw.EncodedHash,
		&pw.ChangeRequired,
		&pw.ChangedAt,
		&verificationID,
		&lastSuccessfulCheck,
		&pw.FailedAttempts,
		&pw.CreatedAt,
		&pw.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if verificationID.Valid {
		pw.VerificationID = &verificationID.String
	}
	if lastSuccessfulCheck.Valid {
		ts := lastSuccessfulCheck.Time
		pw.LastSuccessfulCheck = &ts
	}
	return pw, nil
}

func coerceUserPasswordBool(v any) (any, error) {
	switch b := v.(type) {
	case bool:
		return b, nil
	default:
		return nil, database.ErrCoerceExpectedType("bool", v)
	}
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
		Coerce:   coerceUserPasswordBool,
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
