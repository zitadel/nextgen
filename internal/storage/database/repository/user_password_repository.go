package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userPasswordTable = "zitadel_nextgen.user_passwords"

type UserPasswordRepository struct {
	columnProjectID      database.Column
	columnUserID         database.Column
	columnEncodedHash    database.Column
	columnChangeRequired database.Column
	columnChangedAt      database.Column
	columnVerificationID database.Column
	columnLastSuccessful database.Column
	columnFailedAttempts database.Column
	columnCreatedAt      database.Column
	columnUpdatedAt      database.Column
}

func NewUserPasswordRepository() *UserPasswordRepository {
	return &UserPasswordRepository{
		columnProjectID:      database.NewColumn(userPasswordTable, "project_id"),
		columnUserID:         database.NewColumn(userPasswordTable, "user_id"),
		columnEncodedHash:    database.NewColumn(userPasswordTable, "encoded_hash"),
		columnChangeRequired: database.NewColumn(userPasswordTable, "change_required"),
		columnChangedAt:      database.NewColumn(userPasswordTable, "changed_at"),
		columnVerificationID: database.NewColumn(userPasswordTable, "verification_id"),
		columnLastSuccessful: database.NewColumn(userPasswordTable, "last_successful_check"),
		columnFailedAttempts: database.NewColumn(userPasswordTable, "failed_attempts"),
		columnCreatedAt:      database.NewColumn(userPasswordTable, "created_at"),
		columnUpdatedAt:      database.NewColumn(userPasswordTable, "updated_at"),
	}
}

func (r *UserPasswordRepository) qualifiedTableName() string { return userPasswordTable }

func (r *UserPasswordRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.UserID()}
}

func (r *UserPasswordRepository) UpdatedAtColumn() database.Column { return r.UpdatedAt() }

func (r *UserPasswordRepository) ProjectID() database.Column           { return r.columnProjectID }
func (r *UserPasswordRepository) UserID() database.Column              { return r.columnUserID }
func (r *UserPasswordRepository) EncodedHash() database.Column         { return r.columnEncodedHash }
func (r *UserPasswordRepository) ChangeRequired() database.Column      { return r.columnChangeRequired }
func (r *UserPasswordRepository) ChangedAt() database.Column           { return r.columnChangedAt }
func (r *UserPasswordRepository) VerificationID() database.Column      { return r.columnVerificationID }
func (r *UserPasswordRepository) LastSuccessfulCheck() database.Column { return r.columnLastSuccessful }
func (r *UserPasswordRepository) FailedAttempts() database.Column      { return r.columnFailedAttempts }
func (r *UserPasswordRepository) CreatedAt() database.Column           { return r.columnCreatedAt }
func (r *UserPasswordRepository) UpdatedAt() database.Column           { return r.columnUpdatedAt }

func (r *UserPasswordRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, pid)
}

func (r *UserPasswordRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(r.UserID(), database.TextOperationEqual, uid)
}

func (r *UserPasswordRepository) PrimaryKeyCondition(pid, uid string) database.Condition {
	return database.And(r.ProjectIDCondition(pid), r.UserIDCondition(uid))
}

func (r *UserPasswordRepository) SetEncodedHash(hash string) database.Change {
	return database.NewChange(r.EncodedHash(), hash)
}

func (r *UserPasswordRepository) SetChangeRequired(v bool) database.Change {
	return database.NewChange(r.ChangeRequired(), v)
}

func (r *UserPasswordRepository) SetChangedAt(t time.Time) database.Change {
	return database.NewChange(r.ChangedAt(), t)
}

func (r *UserPasswordRepository) SetVerificationID(id string) database.Change {
	return database.NewChange(r.VerificationID(), id)
}

func (r *UserPasswordRepository) SetLastSuccessfulCheck(t time.Time) database.Change {
	return database.NewChange(r.LastSuccessfulCheck(), t)
}

func (r *UserPasswordRepository) IncrementFailedAttempts() database.Change {
	return database.NewChangeToStatement(r.FailedAttempts(), func(b *database.StatementBuilder) {
		r.FailedAttempts().WriteQualified(b)
		b.WriteString(" + 1")
	})
}

func (r *UserPasswordRepository) ResetFailedAttempts() database.Change {
	return database.NewChange(r.FailedAttempts(), int16(0))
}

func (r *UserPasswordRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserPassword, error) {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(),
		r.UserID(),
		r.EncodedHash(),
		r.ChangeRequired(),
		r.ChangedAt(),
		r.VerificationID(),
		r.LastSuccessfulCheck(),
		r.FailedAttempts(),
		r.CreatedAt(),
		r.UpdatedAt(),
	}.WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	queryOpts := &database.QueryOpts{}
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)
	row, err := getOne[userPasswordRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *UserPasswordRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.UserPassword, error) {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(),
		r.UserID(),
		r.EncodedHash(),
		r.ChangeRequired(),
		r.ChangedAt(),
		r.VerificationID(),
		r.LastSuccessfulCheck(),
		r.FailedAttempts(),
		r.CreatedAt(),
		r.UpdatedAt(),
	}.WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	queryOpts := &database.QueryOpts{}
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)
	rows, err := getMany[userPasswordRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.UserPassword, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *UserPasswordRepository) Create(ctx context.Context, client database.QueryExecutor, pw *domain.CreateUserPassword) error {
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(" (")
	database.Columns{
		r.ProjectID(),
		r.UserID(),
		r.EncodedHash(),
		r.ChangeRequired(),
		r.VerificationID(),
	}.WriteUnqualified(builder)
	builder.WriteString(") VALUES (")
	builder.WriteArgs(pw.ProjectID, pw.UserID, pw.EncodedHash, pw.ChangeRequired, pw.VerificationID)
	builder.WriteString(")")
	_, err := client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *UserPasswordRepository) Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error {
	_, err := deleteOne(ctx, client, r, condition)
	return err
}

type userPasswordRow struct {
	ProjectID           string                   `db:"project_id"`
	UserID              string                   `db:"user_id"`
	EncodedHash         string                   `db:"encoded_hash"`
	ChangeRequired      bool                     `db:"change_required"`
	ChangedAt           time.Time                `db:"changed_at"`
	VerificationID      database.Null[string]    `db:"verification_id"`
	LastSuccessfulCheck database.Null[time.Time] `db:"last_successful_check"`
	FailedAttempts      int16                    `db:"failed_attempts"`
	CreatedAt           time.Time                `db:"created_at"`
	UpdatedAt           time.Time                `db:"updated_at"`
}

func (row *userPasswordRow) toDomain() *domain.UserPassword {
	up := &domain.UserPassword{
		ProjectID:      row.ProjectID,
		UserID:         row.UserID,
		EncodedHash:    row.EncodedHash,
		ChangeRequired: row.ChangeRequired,
		ChangedAt:      row.ChangedAt,
		FailedAttempts: row.FailedAttempts,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.VerificationID.Valid {
		up.VerificationID = &row.VerificationID.V
	}
	if row.LastSuccessfulCheck.Valid {
		ts := row.LastSuccessfulCheck.V
		up.LastSuccessfulCheck = &ts
	}
	return up
}

var _ domain.UserPasswordRepository = (*UserPasswordRepository)(nil)
