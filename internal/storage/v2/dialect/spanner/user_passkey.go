package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	createUserPasskeyStmt = `INSERT INTO user_passkeys (
	project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports, sign_count,
	backup_eligible, backup_state, name, verified_at
) VALUES (
	@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8,
	@p9, @p10, @p11, @p12
) THEN RETURN id, created_at, updated_at`
	deleteUserPasskeyStmt = `DELETE FROM user_passkeys
WHERE project_id = @p1 AND user_id = @p2 AND credential_id = @p3`
	updateUserPasskeyStmt = `UPDATE user_passkeys SET
	attestation_type = @p1,
	transports = @p2,
	sign_count = @p3,
	backup_eligible = @p4,
	backup_state = @p5,
	name = @p6,
	verified_at = @p7,
	last_used_at = @p8,
	updated_at = PENDING_COMMIT_TIMESTAMP()
WHERE project_id = @p9 AND user_id = @p10 AND credential_id = @p11`
	userPasskeyQuery = `SELECT id, project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports,
	sign_count, backup_eligible, backup_state, name, verified_at, last_used_at, created_at, updated_at
FROM user_passkeys`
)

type userPasskeyStatements struct{ statement }

func newUserPasskeyStatements(db queryExecutor) userPasskeyStatements {
	return userPasskeyStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) CreateUserPasskey(ctx context.Context, p *domain.CreateUserPasskey) error {
	transports := p.Transports
	if transports == nil {
		transports = []string{}
	}
	stmt := buildStatement(createUserPasskeyStmt,
		p.ProjectID,
		p.UserID,
		p.CredentialID,
		p.PublicKey,
		nullBytesArg(p.AAGUID),
		p.AttestationType,
		transports,
		p.SignCount,
		p.BackupEligible,
		p.BackupState,
		nullStringArg(p.Name),
		p.VerifiedAt,
	).statement()

	return ps.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			var (
				id                   int64
				createdAt, updatedAt time.Time
			)
			return struct{}{}, row.Columns(&id, &createdAt, &updatedAt)
		})
		return err
	})
}

// GetUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) GetUserPasskey(ctx context.Context, projectID, userID, credentialID string) (*domain.UserPasskey, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasskeyQuery, &database.ListOptions[domain.UserPasskeyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
			database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credentialID),
		),
	}, userPasskeySchema); err != nil {
		return nil, err
	}

	var passkey *domain.UserPasskey
	err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		passkey, err = collectOneRow(iter, ps.scanUserPasskey)
		return err
	})
	if err != nil {
		return nil, err
	}
	return passkey, nil
}

// ListUserPasskeys implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) ListUserPasskeys(ctx context.Context, filter *database.ListOptions[domain.UserPasskeyField]) (*database.ListResult[*domain.UserPasskey], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasskeyQuery, filter, userPasskeySchema); err != nil {
		return nil, err
	}

	var passkeys []*domain.UserPasskey
	err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		passkeys, err = collectRows(iter, ps.scanUserPasskey)
		return err
	})
	if err != nil {
		return nil, err
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(passkeys) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.UserPasskeyField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  userPasskeySchema.ValuesFrom(passkeys[len(passkeys)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.UserPasskey]{
		Items:      passkeys,
		NextCursor: nextCursor,
	}, nil
}

// UpdateUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) UpdateUserPasskey(ctx context.Context, p *domain.UserPasskey) error {
	transports := p.Transports
	if transports == nil {
		transports = []string{}
	}
	stmt := buildStatement(updateUserPasskeyStmt,
		p.AttestationType,
		transports,
		p.SignCount,
		p.BackupEligible,
		p.BackupState,
		nullStringArg(p.Name),
		p.VerifiedAt,
		p.LastUsedAt,
		p.ProjectID,
		p.UserID,
		p.CredentialID,
	).statement()
	n, err := ps.db.Update(ctx, stmt)
	if err != nil {
		return err
	}
	if n == 0 {
		return storagedb.NewNoRowFoundError(nil)
	}
	if n > 1 {
		return storagedb.NewMultipleRowsFoundError(nil)
	}
	return nil
}

// DeleteUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) DeleteUserPasskey(ctx context.Context, projectID, userID, credentialID string) error {
	stmt := buildStatement(deleteUserPasskeyStmt, projectID, userID, credentialID).statement()
	n, err := ps.db.Update(ctx, stmt)
	if err != nil {
		return err
	}
	if n == 0 {
		return storagedb.NewNoRowFoundError(nil)
	}
	if n > 1 {
		return storagedb.NewMultipleRowsFoundError(nil)
	}
	return nil
}

func (ps userPasskeyStatements) scanUserPasskey(row *spanner.Row) (*domain.UserPasskey, error) {
	p := new(domain.UserPasskey)
	var (
		aaguid          []byte
		attestationType spanner.NullString
		transports      []string
		name            spanner.NullString
		verifiedAt      spanner.NullTime
		lastUsedAt      spanner.NullTime
		createdAt       time.Time
		updatedAt       time.Time
	)
	if err := row.Columns(
		&p.ID,
		&p.ProjectID,
		&p.UserID,
		&p.CredentialID,
		&p.PublicKey,
		&aaguid,
		&attestationType,
		&transports,
		&p.SignCount,
		&p.BackupEligible,
		&p.BackupState,
		&name,
		&verifiedAt,
		&lastUsedAt,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	p.PublicKey = append([]byte(nil), p.PublicKey...)
	p.AAGUID = append([]byte(nil), aaguid...)
	if transports == nil {
		p.Transports = []string{}
	} else {
		p.Transports = append([]string(nil), transports...)
	}
	if attestationType.Valid {
		v := attestationType.StringVal
		p.AttestationType = &v
	}
	if name.Valid {
		p.Name = name.StringVal
	}
	if verifiedAt.Valid {
		ts := verifiedAt.Time
		p.VerifiedAt = &ts
	}
	if lastUsedAt.Valid {
		ts := lastUsedAt.Time
		p.LastUsedAt = &ts
	}
	cr, up := createdAt, updatedAt
	p.CreatedAt = &cr
	p.UpdatedAt = &up
	return p, nil
}

func nullBytesArg(v []byte) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

func nullStringArg(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func optionalTimeAccessor(get func(*domain.UserPasskey) *time.Time) func(*domain.UserPasskey) any {
	return func(p *domain.UserPasskey) any {
		if v := get(p); v != nil {
			return *v
		}
		return time.Time{}
	}
}

func coerceBool(v any) (any, error) {
	switch b := v.(type) {
	case bool:
		return b, nil
	default:
		return nil, database.ErrCoerceExpectedType("bool", v)
	}
}

var _ service.UserPasskeyStatements = (*userPasskeyStatements)(nil)

var userPasskeySchema = database.NewSchema(map[domain.UserPasskeyField]database.FieldBinding[domain.UserPasskey]{
	domain.UserPasskeyFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.UserPasskey) any { return p.ID },
		Coerce:   database.CoerceNumber[int64],
	},
	domain.UserPasskeyFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(p *domain.UserPasskey) any { return p.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(p *domain.UserPasskey) any { return p.UserID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldCredentialID: {
		SQLName:  "credential_id",
		Accessor: func(p *domain.UserPasskey) any { return p.CredentialID },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldSignCount: {
		SQLName:  "sign_count",
		Accessor: func(p *domain.UserPasskey) any { return p.SignCount },
		Coerce:   database.CoerceNumber[int64],
	},
	domain.UserPasskeyFieldBackupEligible: {
		SQLName:  "backup_eligible",
		Accessor: func(p *domain.UserPasskey) any { return p.BackupEligible },
		Coerce:   coerceBool,
	},
	domain.UserPasskeyFieldBackupState: {
		SQLName:  "backup_state",
		Accessor: func(p *domain.UserPasskey) any { return p.BackupState },
		Coerce:   coerceBool,
	},
	domain.UserPasskeyFieldName: {
		SQLName:  "name",
		Accessor: func(p *domain.UserPasskey) any { return p.Name },
		Coerce:   database.CoerceString,
	},
	domain.UserPasskeyFieldVerifiedAt: {
		SQLName:  "verified_at",
		Accessor: optionalTimeAccessor(func(p *domain.UserPasskey) *time.Time { return p.VerifiedAt }),
		Coerce:   database.CoerceTime,
	},
	domain.UserPasskeyFieldLastUsedAt: {
		SQLName:  "last_used_at",
		Accessor: optionalTimeAccessor(func(p *domain.UserPasskey) *time.Time { return p.LastUsedAt }),
		Coerce:   database.CoerceTime,
	},
	domain.UserPasskeyFieldCreatedAt: {
		SQLName: "created_at",
		Accessor: func(p *domain.UserPasskey) any {
			if p.CreatedAt == nil {
				return time.Time{}
			}
			return *p.CreatedAt
		},
		Coerce: database.CoerceTime,
	},
	domain.UserPasskeyFieldUpdatedAt: {
		SQLName: "updated_at",
		Accessor: func(p *domain.UserPasskey) any {
			if p.UpdatedAt == nil {
				return time.Time{}
			}
			return *p.UpdatedAt
		},
		Coerce: database.CoerceTime,
	},
})
