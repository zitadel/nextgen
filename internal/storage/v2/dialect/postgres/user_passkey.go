package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const createUserPasskeyStmt = `INSERT INTO zitadel_nextgen.user_passkeys (
	project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports, sign_count,
	backup_eligible, backup_state, name, verified_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8,
	$9, $10, $11, $12
)`

const deleteUserPasskeyStmt = `DELETE FROM zitadel_nextgen.user_passkeys
WHERE project_id = $1 AND user_id = $2 AND credential_id = $3`

const updateUserPasskeyStmt = `UPDATE zitadel_nextgen.user_passkeys SET
	attestation_type = $1,
	transports = $2,
	sign_count = $3,
	backup_eligible = $4,
	backup_state = $5,
	name = $6,
	verified_at = $7,
	last_used_at = $8,
	updated_at = now()
WHERE project_id = $9 AND user_id = $10 AND credential_id = $11`

const userPasskeyQuery = `SELECT id, project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports,
	sign_count, backup_eligible, backup_state, name, verified_at, last_used_at, created_at, updated_at
FROM zitadel_nextgen.user_passkeys`

type userPasskeyStatements struct{ statement }

func newUserPasskeyStatements(client queryExecutor) userPasskeyStatements {
	return userPasskeyStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) CreateUserPasskey(ctx context.Context, p *domain.CreateUserPasskey) error {
	transports := p.Transports
	if transports == nil {
		transports = []string{}
	}
	_, err := ps.client.Exec(ctx, createUserPasskeyStmt,
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
	)
	return wrapError(err)
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

	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	passkey, err := pgx.CollectExactlyOneRow(rows, ps.scanUserPasskey)
	if err != nil {
		return nil, wrapError(err)
	}
	return passkey, nil
}

// ListUserPasskeys implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) ListUserPasskeys(ctx context.Context, filter *database.ListOptions[domain.UserPasskeyField]) (*database.ListResult[*domain.UserPasskey], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasskeyQuery, filter, userPasskeySchema); err != nil {
		return nil, err
	}

	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	passkeys, err := pgx.CollectRows(rows, ps.scanUserPasskey)
	if err != nil {
		return nil, wrapError(err)
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
	tag, err := ps.client.Exec(ctx, updateUserPasskeyStmt,
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
	)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return storagedb.NewNoRowFoundError(nil)
	}
	if tag.RowsAffected() > 1 {
		return storagedb.NewMultipleRowsFoundError(nil)
	}
	return nil
}

// DeleteUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) DeleteUserPasskey(ctx context.Context, projectID, userID, credentialID string) error {
	tag, err := ps.client.Exec(ctx, deleteUserPasskeyStmt, projectID, userID, credentialID)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return storagedb.NewNoRowFoundError(nil)
	}
	if tag.RowsAffected() > 1 {
		return storagedb.NewMultipleRowsFoundError(nil)
	}
	return nil
}

func (ps userPasskeyStatements) scanUserPasskey(row pgx.CollectableRow) (*domain.UserPasskey, error) {
	p := new(domain.UserPasskey)
	var (
		aaguid          []byte
		attestationType *string
		transports      []string
		name            *string
		verifiedAt      *time.Time
		lastUsedAt      *time.Time
		createdAt       time.Time
		updatedAt       time.Time
	)
	if err := row.Scan(
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
	p.AttestationType = attestationType
	if name != nil {
		p.Name = *name
	}
	p.VerifiedAt = verifiedAt
	p.LastUsedAt = lastUsedAt
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