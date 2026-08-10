package spanner

import (
	"context"
	"fmt"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/userpasskey"
)

const (
	createUserPasskeyStmt = `INSERT INTO user_passkeys (
	id, project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports, sign_count,
	backup_eligible, backup_state, name, verified_at
) VALUES (
	@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8,
	@p9, @p10, @p11, @p12, @p13
)`
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
	if err := ensureManagedID(&p.ID, domain.PrefixUserPasskey); err != nil {
		return err
	}
	transports := p.Transports
	if transports == nil {
		transports = []string{}
	}
	_, err := ps.db.Update(ctx, buildStatement(createUserPasskeyStmt,
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
	).statement())
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
		return nil, wrapError(spanner.ErrRowNotFound)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(errTooManyRows)
	}
}

// ListUserPasskeys implements [service.UserPasskeyStatements].
func (ps userPasskeyStatements) ListUserPasskeys(ctx context.Context, filter *database.ListOptions[domain.UserPasskeyField]) (*database.ListResult[*domain.UserPasskey], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasskeyQuery, filter, userpasskey.Schema); err != nil {
		return nil, err
	}

	var passkeys []*domain.UserPasskey
	err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		passkeys, err = collectRows(iter, ps.scanUserPasskey)
		return err
	})
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(passkeys) == int(filter.Pagination.Limit) {
		nextCursor = pagination.New(filter.Pagination.OrderBy, userpasskey.Schema.ValuesFrom(passkeys[len(passkeys)-1], filter.Pagination.OrderBy.Columns)).Marshal()
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

	c.WriteString(", updated_at = CURRENT_TIMESTAMP() WHERE ")
	compileFilter(&c, filter, userpasskey.Schema)

	n, err := ps.db.Update(ctx, c.statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return wrapError(spanner.ErrRowNotFound)
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
	_, err := ps.db.Update(ctx, c.statement())
	return wrapError(err)
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
	return p, nil
}

func nullBytesArg(v []byte) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

var _ service.UserPasskeyStatements = (*userPasskeyStatements)(nil)
