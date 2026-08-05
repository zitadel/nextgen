package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/userpasskey"
)

const createUserPasskeyStmt = `INSERT INTO zitadel_nextgen.user_passkeys (
	id, project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports, sign_count,
	backup_eligible, backup_state, name, verified_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8,
	$9, $10, $11, $12, $13
)`

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
	if err := ensureManagedID(&p.ID, domain.PrefixUserPasskey); err != nil {
		return err
	}
	transports := p.Transports
	if transports == nil {
		transports = []string{}
	}
	_, err := ps.client.Exec(ctx, createUserPasskeyStmt,
		p.ID,
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
		p.Name,
		p.VerifiedAt,
	)
	return wrapError(err)
}

// GetUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) GetUserPasskey(ctx context.Context, filter database.Filter[domain.UserPasskeyField]) (*domain.UserPasskey, error) {
	result, err := ps.ListUserPasskeys(ctx, &database.ListOptions[domain.UserPasskeyField]{Filter: filter})
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

// ListUserPasskeys implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) ListUserPasskeys(ctx context.Context, filter *database.ListOptions[domain.UserPasskeyField]) (*database.ListResult[*domain.UserPasskey], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasskeyQuery, filter, userpasskey.Schema); err != nil {
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
			Values:  userpasskey.Schema.ValuesFrom(passkeys[len(passkeys)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.UserPasskey]{
		Items:      passkeys,
		NextCursor: nextCursor,
	}, nil
}

// UpdateUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) UpdateUserPasskey(ctx context.Context, filter database.Filter[domain.UserPasskeyField], updates ...domain.UserPasskeyUpdate) error {
	if filter == nil {
		return fmt.Errorf("UserPasskey filter is required")
	}
	if len(updates) == 0 {
		return database.ErrNoChanges
	}

	var c statementCompiler
	c.WriteString("UPDATE zitadel_nextgen.user_passkeys SET ")
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
		case *domain.UserPasskeyAttestationTypeUpdate:
			writeAssign("attestation_type", u.AttestationType)
		case *domain.UserPasskeyTransportsUpdate:
			transports := u.Transports
			if transports == nil {
				transports = []string{}
			}
			writeAssign("transports", transports)
		case *domain.UserPasskeySignCountUpdate:
			writeAssign("sign_count", u.SignCount)
		case *domain.UserPasskeyBackupEligibleUpdate:
			writeAssign("backup_eligible", u.BackupEligible)
		case *domain.UserPasskeyBackupStateUpdate:
			writeAssign("backup_state", u.BackupState)
		case *domain.UserPasskeyVerifiedAtUpdate:
			writeAssign("verified_at", u.VerifiedAt)
		case *domain.UserPasskeyLastUsedAtUpdate:
			writeAssign("last_used_at", u.LastUsedAt)
		default:
			return fmt.Errorf("unknown UserPasskeyUpdate %T", update)
		}
	}

	c.WriteString(", updated_at = NOW() WHERE ")
	compileFilter(&c, filter, userpasskey.Schema)

	tag, err := ps.client.Exec(ctx, c.String(), c.args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

// DeleteUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) DeleteUserPasskey(ctx context.Context, filter database.Filter[domain.UserPasskeyField]) error {
	if filter == nil {
		return fmt.Errorf("UserPasskey filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM zitadel_nextgen.user_passkeys WHERE ")
	compileFilter(&c, filter, userpasskey.Schema)
	_, err := ps.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
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
		&p.CreatedAt,
		&p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	p.PublicKey = append([]byte(nil), p.PublicKey...)
	p.AAGUID = append([]byte(nil), aaguid...)
	if transports == nil {
		p.Transports = []string{}
	} else {
		p.Transports = append([]string{}, transports...)
	}
	p.AttestationType = attestationType
	if name != nil {
		p.Name = *name
	}
	p.VerifiedAt = verifiedAt
	p.LastUsedAt = lastUsedAt
	return p, nil
}

func nullBytesArg(v []byte) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

var _ service.UserPasskeyStatements = (*userPasskeyStatements)(nil)
