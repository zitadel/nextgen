package repository

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userPasskeyTable = "zitadel_nextgen.user_passkeys"

type UserPasskeyRepository struct {
	colProject database.Column
	colUser    database.Column
	colCred    database.Column
	colPub     database.Column
	colAagu    database.Column
	colAtt     database.Column
	colTrans   database.Column
	colSign    database.Column
	colBElig   database.Column
	colBState  database.Column
	colName    database.Column
	colVerif   database.Column
	colLU      database.Column
	colCre     database.Column
	colUpd     database.Column
}

func NewUserPasskeyRepository() *UserPasskeyRepository {
	t := userPasskeyTable
	return &UserPasskeyRepository{
		colProject: database.NewColumn(t, "project_id"),
		colUser:    database.NewColumn(t, "user_id"),
		colCred:    database.NewColumn(t, "credential_id"),
		colPub:     database.NewColumn(t, "public_key"),
		colAagu:    database.NewColumn(t, "aaguid"),
		colAtt:     database.NewColumn(t, "attestation_type"),
		colTrans:   database.NewColumn(t, "transports"),
		colSign:    database.NewColumn(t, "sign_count"),
		colBElig:   database.NewColumn(t, "backup_eligible"),
		colBState:  database.NewColumn(t, "backup_state"),
		colName:    database.NewColumn(t, "name"),
		colVerif:   database.NewColumn(t, "verified_at"),
		colLU:      database.NewColumn(t, "last_used_at"),
		colCre:     database.NewColumn(t, "created_at"),
		colUpd:     database.NewColumn(t, "updated_at"),
	}
}

func (r *UserPasskeyRepository) qualifiedTableName() string { return userPasskeyTable }
func (r *UserPasskeyRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.UserID(), r.CredentialID()}
}
func (r *UserPasskeyRepository) UpdatedAtColumn() database.Column { return r.UpdatedAt() }

func (r *UserPasskeyRepository) ProjectID() database.Column       { return r.colProject }
func (r *UserPasskeyRepository) UserID() database.Column          { return r.colUser }
func (r *UserPasskeyRepository) CredentialID() database.Column    { return r.colCred }
func (r *UserPasskeyRepository) PublicKey() database.Column       { return r.colPub }
func (r *UserPasskeyRepository) AAGUID() database.Column          { return r.colAagu }
func (r *UserPasskeyRepository) AttestationType() database.Column { return r.colAtt }
func (r *UserPasskeyRepository) Transports() database.Column      { return r.colTrans }
func (r *UserPasskeyRepository) SignCount() database.Column       { return r.colSign }
func (r *UserPasskeyRepository) BackupEligible() database.Column  { return r.colBElig }
func (r *UserPasskeyRepository) BackupState() database.Column     { return r.colBState }
func (r *UserPasskeyRepository) Name() database.Column            { return r.colName }
func (r *UserPasskeyRepository) VerifiedAt() database.Column      { return r.colVerif }
func (r *UserPasskeyRepository) LastUsedAt() database.Column      { return r.colLU }
func (r *UserPasskeyRepository) CreatedAt() database.Column       { return r.colCre }
func (r *UserPasskeyRepository) UpdatedAt() database.Column       { return r.colUpd }

func (r *UserPasskeyRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, pid)
}
func (r *UserPasskeyRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(r.UserID(), database.TextOperationEqual, uid)
}
func (r *UserPasskeyRepository) CredentialIDCondition(cid string) database.Condition {
	cred, err := base64.RawURLEncoding.DecodeString(cid)
	if err != nil {
		return malformedPasskeyCredCondition{}
	}
	return database.NewBytesCondition[[]byte](r.CredentialID(), database.BytesOperationEqual, cred)
}
func (r *UserPasskeyRepository) PrimaryKeyCondition(pid, uid, cid string) database.Condition {
	return database.And(
		r.ProjectIDCondition(pid),
		r.UserIDCondition(uid),
		r.CredentialIDCondition(cid),
	)
}

func (r *UserPasskeyRepository) SetAttestationType(s string) database.Change {
	return database.NewChange(r.AttestationType(), s)
}
func (r *UserPasskeyRepository) SetTransports(v []string) database.Change {
	return database.NewChange(r.Transports(), v)
}
func (r *UserPasskeyRepository) IncrementSignCount(diff int64) database.Change {
	return database.NewChangeToStatement(r.SignCount(), func(b *database.StatementBuilder) {
		r.SignCount().WriteQualified(b)
		b.WriteString(" + ")
		b.WriteArg(diff)
	})
}
func (r *UserPasskeyRepository) SetBackupEligible(v bool) database.Change {
	return database.NewChange(r.BackupEligible(), v)
}
func (r *UserPasskeyRepository) SetBackupState(v bool) database.Change {
	return database.NewChange(r.BackupState(), v)
}
func (r *UserPasskeyRepository) SetVerifiedAt(t time.Time) database.Change {
	return database.NewChange(r.VerifiedAt(), t)
}
func (r *UserPasskeyRepository) SetLastUsedAt(t time.Time) database.Change {
	return database.NewChange(r.LastUsedAt(), t)
}

func (r *UserPasskeyRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserPasskey, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(), r.UserID(), r.CredentialID(), r.PublicKey(),
		r.AAGUID(), r.AttestationType(), r.Transports(), r.SignCount(),
		r.BackupEligible(), r.BackupState(), r.Name(), r.VerifiedAt(), r.LastUsedAt(),
		r.CreatedAt(), r.UpdatedAt(),
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
		r.ProjectID(), r.UserID(), r.CredentialID(), r.PublicKey(),
		r.AAGUID(), r.AttestationType(), r.Transports(), r.SignCount(),
		r.BackupEligible(), r.BackupState(), r.Name(), r.VerifiedAt(), r.LastUsedAt(),
		r.CreatedAt(), r.UpdatedAt(),
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
	cred, err := base64.RawURLEncoding.DecodeString(p.CredentialID)
	if err != nil {
		return fmt.Errorf("credential_id: %w", err)
	}
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(` (project_id, user_id, credential_id, public_key, aaguid, attestation_type, transports, sign_count,
		backup_eligible, backup_state, name, verified_at) VALUES (`)
	builder.WriteArgs(
		p.ProjectID, p.UserID, cred, p.PublicKey, nullBytes(p.AAGUID), p.AttestationType,
		p.Transports, p.SignCount, p.BackupEligible, p.BackupState, p.Name, p.VerifiedAt)
	builder.WriteString(")")
	_, err = client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *UserPasskeyRepository) Delete(ctx context.Context, client database.QueryExecutor, cond database.Condition) error {
	_, err := deleteOne(ctx, client, r, cond)
	return err
}

type malformedPasskeyCredCondition struct{}

func (malformedPasskeyCredCondition) Write(b *database.StatementBuilder) {
	b.WriteString("FALSE")
}

func (malformedPasskeyCredCondition) Matches(any) bool { return true }

func (malformedPasskeyCredCondition) String() string { return "malformedPasskeyCredCondition" }

func (malformedPasskeyCredCondition) IsRestrictingColumn(database.Column) bool { return false }

var _ database.Condition = malformedPasskeyCredCondition{}

type userPasskeyRow struct {
	ProjectID       string                   `db:"project_id"`
	UserID          string                   `db:"user_id"`
	CredentialIDRaw []byte                   `db:"credential_id"`
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
		CredentialID:   base64.RawURLEncoding.EncodeToString(row.CredentialIDRaw),
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
