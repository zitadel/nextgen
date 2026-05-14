package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userPasskeyTable = "zitadel_nextgen.user_passkeys"

var (
	colPasskeyProjectID       = database.NewColumn(userPasskeyTable, "project_id")
	colPasskeyUserID          = database.NewColumn(userPasskeyTable, "user_id")
	colPasskeyCredentialID    = database.NewColumn(userPasskeyTable, "credential_id")
	colPasskeyPublicKey       = database.NewColumn(userPasskeyTable, "public_key")
	colPasskeyAAGUID          = database.NewColumn(userPasskeyTable, "aaguid")
	colPasskeyAttestationType = database.NewColumn(userPasskeyTable, "attestation_type")
	colPasskeyTransports      = database.NewColumn(userPasskeyTable, "transports")
	colPasskeySignCount       = database.NewColumn(userPasskeyTable, "sign_count")
	colPasskeyBackupEligible  = database.NewColumn(userPasskeyTable, "backup_eligible")
	colPasskeyBackupState     = database.NewColumn(userPasskeyTable, "backup_state")
	colPasskeyName            = database.NewColumn(userPasskeyTable, "name")
	colPasskeyVerifiedAt      = database.NewColumn(userPasskeyTable, "verified_at")
	colPasskeyLastUsedAt      = database.NewColumn(userPasskeyTable, "last_used_at")
	colPasskeyCreatedAt       = database.NewColumn(userPasskeyTable, "created_at")
	colPasskeyUpdatedAt       = database.NewColumn(userPasskeyTable, "updated_at")
)

type UserPasskeyRepository struct{}

func NewUserPasskeyRepository() *UserPasskeyRepository {
	return &UserPasskeyRepository{}
}

func (r *UserPasskeyRepository) qualifiedTableName() string { return userPasskeyTable }

func (r *UserPasskeyRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{colPasskeyProjectID, colPasskeyUserID, colPasskeyCredentialID}
}

func (r *UserPasskeyRepository) UpdatedAtColumn() database.Column { return colPasskeyUpdatedAt }

func (r *UserPasskeyRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(colPasskeyProjectID, database.TextOperationEqual, pid)
}

func (r *UserPasskeyRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(colPasskeyUserID, database.TextOperationEqual, uid)
}

func (r *UserPasskeyRepository) CredentialIDCondition(cid string) database.Condition {
	return database.NewTextCondition(colPasskeyCredentialID, database.TextOperationEqual, cid)
}

func (r *UserPasskeyRepository) PrimaryKeyCondition(pid, uid, cid string) database.Condition {
	return database.And(
		r.ProjectIDCondition(pid),
		r.UserIDCondition(uid),
		r.CredentialIDCondition(cid),
	)
}

func (r *UserPasskeyRepository) SetAttestationType(s string) database.Change {
	return database.NewChange(colPasskeyAttestationType, s)
}

func (r *UserPasskeyRepository) SetTransports(v []string) database.Change {
	return database.NewChange(colPasskeyTransports, v)
}

func (r *UserPasskeyRepository) IncrementSignCount(diff int64) database.Change {
	return database.NewChangeToStatement(colPasskeySignCount, func(b *database.StatementBuilder) {
		colPasskeySignCount.WriteQualified(b)
		b.WriteString(" + ")
		b.WriteArg(diff)
	})
}

func (r *UserPasskeyRepository) SetBackupEligible(v bool) database.Change {
	return database.NewChange(colPasskeyBackupEligible, v)
}

func (r *UserPasskeyRepository) SetBackupState(v bool) database.Change {
	return database.NewChange(colPasskeyBackupState, v)
}

func (r *UserPasskeyRepository) SetVerifiedAt(t time.Time) database.Change {
	return database.NewChange(colPasskeyVerifiedAt, t)
}

func (r *UserPasskeyRepository) SetLastUsedAt(t time.Time) database.Change {
	return database.NewChange(colPasskeyLastUsedAt, t)
}

func (r *UserPasskeyRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserPasskey, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		colPasskeyProjectID, colPasskeyUserID, colPasskeyCredentialID, colPasskeyPublicKey,
		colPasskeyAAGUID, colPasskeyAttestationType, colPasskeyTransports, colPasskeySignCount,
		colPasskeyBackupEligible, colPasskeyBackupState, colPasskeyName, colPasskeyVerifiedAt, colPasskeyLastUsedAt,
		colPasskeyCreatedAt, colPasskeyUpdatedAt,
	}.WriteQualified(b)
	b.WriteString(" FROM ")
	b.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(b)
	row, err := getOne[userPasskeyRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *UserPasskeyRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.UserPasskey, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		colPasskeyProjectID, colPasskeyUserID, colPasskeyCredentialID, colPasskeyPublicKey,
		colPasskeyAAGUID, colPasskeyAttestationType, colPasskeyTransports, colPasskeySignCount,
		colPasskeyBackupEligible, colPasskeyBackupState, colPasskeyName, colPasskeyVerifiedAt, colPasskeyLastUsedAt,
		colPasskeyCreatedAt, colPasskeyUpdatedAt,
	}.WriteQualified(b)
	b.WriteString(" FROM ")
	b.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(b)
	rows, err := getMany[userPasskeyRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.UserPasskey, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *UserPasskeyRepository) Create(ctx context.Context, client database.QueryExecutor, p *domain.CreateUserPasskey) error {
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(` (project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports, sign_count,
		backup_eligible, backup_state, name, verified_at) VALUES (`)
	builder.WriteArgs(
		p.ProjectID, p.UserID, p.CredentialID, p.PublicKey, nullBytes(p.AAGUID), p.AttestationType,
		p.Transports, p.SignCount, p.BackupEligible, p.BackupState, p.Name, p.VerifiedAt)
	builder.WriteString(")")
	_, err := client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *UserPasskeyRepository) Delete(ctx context.Context, client database.QueryExecutor, cond database.Condition) error {
	_, err := deleteOne(ctx, client, r, cond)
	return err
}

type userPasskeyRow struct {
	ProjectID       string                   `db:"project_id"`
	UserID          string                   `db:"user_id"`
	CredentialID    string                   `db:"credential_id"`
	PublicKey       []byte                   `db:"public_key"`
	AAGUID          []byte                   `db:"aaguid"`
	AttestationType database.Null[string]    `db:"attestation_type"`
	Transports      []string                 `db:"transports"`
	SignCount       int64                    `db:"sign_count"`
	BackupEligible  bool                     `db:"backup_eligible"`
	BackupState     bool                     `db:"backup_state"`
	Name            database.Null[string]    `db:"name"`
	VerifiedAt      database.Null[time.Time] `db:"verified_at"`
	LastUsedAt      database.Null[time.Time] `db:"last_used_at"`
	CreatedAt       time.Time                `db:"created_at"`
	UpdatedAt       time.Time                `db:"updated_at"`
}

func (row *userPasskeyRow) toDomain() *domain.UserPasskey {
	p := &domain.UserPasskey{
		ProjectID:      row.ProjectID,
		UserID:         row.UserID,
		CredentialID:   row.CredentialID,
		PublicKey:      append([]byte(nil), row.PublicKey...),
		AAGUID:         append([]byte(nil), row.AAGUID...),
		Transports:     append([]string(nil), row.Transports...),
		SignCount:      row.SignCount,
		BackupEligible: row.BackupEligible,
		BackupState:    row.BackupState,
	}
	if row.AttestationType.Valid {
		p.AttestationType = &row.AttestationType.V
	}
	if row.Name.Valid {
		p.Name = row.Name.V
	}
	if row.VerifiedAt.Valid {
		ts := row.VerifiedAt.V
		p.VerifiedAt = &ts
	}
	if row.LastUsedAt.Valid {
		ts := row.LastUsedAt.V
		p.LastUsedAt = &ts
	}
	cr := row.CreatedAt
	up := row.UpdatedAt
	p.CreatedAt = &cr
	p.UpdatedAt = &up
	return p
}

func nullBytes(v []byte) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

var _ domain.UserPasskeyRepository = (*UserPasskeyRepository)(nil)
