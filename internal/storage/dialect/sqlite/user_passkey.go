package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/userpasskey"
)

const (
	createUserPasskeyStmt = `INSERT INTO user_passkeys (
	project_id, id, user_id, credential_id, public_key, aaguid, attestation_type, transports, sign_count,
	backup_eligible, backup_state, name, verified_at, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	userPasskeyQuery = `SELECT id, project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports,
	sign_count, backup_eligible, backup_state, name, verified_at, last_used_at, created_at, updated_at
FROM user_passkeys`
)

type userPasskeyStatements struct{ statement }

func newUserPasskeyStatements(client queryExecutor) userPasskeyStatements {
	return userPasskeyStatements{statement: statement{client: client}}
}

// CreateUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) CreateUserPasskey(ctx context.Context, p *domain.CreateUserPasskey) error {
	id := ""
	if err := ensureManagedID(&id, domain.PrefixUserPasskey); err != nil {
		return err
	}
	transports := p.Transports
	if transports == nil {
		transports = []string{}
	}
	transportsJSON, err := encodeJSON(transports)
	if err != nil {
		return wrapError(err)
	}
	now := nowUnixNano()
	_, err = ps.client.Exec(ctx, createUserPasskeyStmt,
		p.ProjectID,
		id,
		p.UserID,
		p.CredentialID,
		p.PublicKey,
		nullBytesArg(p.AAGUID),
		nullStringArg(p.AttestationType),
		transportsJSON,
		p.SignCount,
		p.BackupEligible,
		p.BackupState,
		p.Name,
		nullUnixNano(p.VerifiedAt),
		now,
		now,
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
		return nil, database.NewNoRowFoundError(nil)
	case 1:
		return result.Items[0], nil
	default:
		return nil, database.NewMultipleRowsFoundError(nil)
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
	defer rows.Close()
	passkeys, err := collectRows(rows, scanUserPasskey)
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
	return &database.ListResult[*domain.UserPasskey]{Items: passkeys, NextCursor: nextCursor}, nil
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
	c.WriteString("UPDATE user_passkeys SET ")
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
			transportsJSON, err := encodeJSON(transports)
			if err != nil {
				return err
			}
			writeAssign("transports", transportsJSON)
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

	c.WriteString(", updated_at = ")
	c.WriteArg(nowUnixNano())
	c.WriteString(" WHERE ")
	compileFilter(&c, filter, userpasskey.Schema)

	n, err := execAffected(ctx, ps.client, c.String(), c.args...)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteUserPasskey implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) DeleteUserPasskey(ctx context.Context, filter database.Filter[domain.UserPasskeyField]) error {
	if filter == nil {
		return fmt.Errorf("UserPasskey filter is required")
	}
	var c statementCompiler
	c.WriteString("DELETE FROM user_passkeys WHERE ")
	compileFilter(&c, filter, userpasskey.Schema)
	_, err := ps.client.Exec(ctx, c.String(), c.args...)
	return wrapError(err)
}

func scanUserPasskey(rows *sql.Rows) (*domain.UserPasskey, error) {
	p := new(domain.UserPasskey)
	var (
		aaguid               []byte
		attestationType      sql.NullString
		transportsStr        string
		name                 sql.NullString
		verifiedNano         sql.NullInt64
		lastUsedNano         sql.NullInt64
		createdNano, updNano int64
	)
	if err := rows.Scan(
		&p.ID,
		&p.ProjectID,
		&p.UserID,
		&p.CredentialID,
		&p.PublicKey,
		&aaguid,
		&attestationType,
		&transportsStr,
		&p.SignCount,
		&p.BackupEligible,
		&p.BackupState,
		&name,
		&verifiedNano,
		&lastUsedNano,
		&createdNano,
		&updNano,
	); err != nil {
		return nil, err
	}
	p.PublicKey = append([]byte(nil), p.PublicKey...)
	p.AAGUID = append([]byte(nil), aaguid...)
	transports, err := decodeJSONStrings(transportsStr)
	if err != nil {
		return nil, fmt.Errorf("decode transports: %w", err)
	}
	if transports == nil {
		p.Transports = []string{}
	} else {
		p.Transports = transports
	}
	if attestationType.Valid {
		v := attestationType.String
		p.AttestationType = &v
	}
	if name.Valid {
		p.Name = name.String
	}
	if verifiedNano.Valid {
		t := timeFromUnixNano(verifiedNano.Int64)
		p.VerifiedAt = &t
	}
	if lastUsedNano.Valid {
		t := timeFromUnixNano(lastUsedNano.Int64)
		p.LastUsedAt = &t
	}
	p.CreatedAt = timeFromUnixNano(createdNano)
	p.UpdatedAt = timeFromUnixNano(updNano)
	return p, nil
}

func nullBytesArg(v []byte) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

func nullStringArg(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

var _ service.UserPasskeyStatements = (*userPasskeyStatements)(nil)
