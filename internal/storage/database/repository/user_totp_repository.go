package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userTotpTable = "zitadel_nextgen.user_totp"

type UserTOTPRepository struct {
	colProject database.Column
	colUser    database.Column
	colSecret  database.Column
	colVer     database.Column
	colLastOk  database.Column
	colFails   database.Column
	colCre     database.Column
	colUpd     database.Column
}

func NewUserTOTPRepository() *UserTOTPRepository {
	t := userTotpTable
	return &UserTOTPRepository{
		colProject: database.NewColumn(t, "project_id"),
		colUser:    database.NewColumn(t, "user_id"),
		colSecret:  database.NewColumn(t, "secret"),
		colVer:     database.NewColumn(t, "verified_at"),
		colLastOk:  database.NewColumn(t, "last_successful_check"),
		colFails:   database.NewColumn(t, "failed_attempts"),
		colCre:     database.NewColumn(t, "created_at"),
		colUpd:     database.NewColumn(t, "updated_at"),
	}
}

func (r *UserTOTPRepository) qualifiedTableName() string { return userTotpTable }
func (r *UserTOTPRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.UserID()}
}
func (r *UserTOTPRepository) UpdatedAtColumn() database.Column     { return r.UpdatedAt() }
func (r *UserTOTPRepository) ProjectID() database.Column           { return r.colProject }
func (r *UserTOTPRepository) UserID() database.Column              { return r.colUser }
func (r *UserTOTPRepository) Secret() database.Column              { return r.colSecret }
func (r *UserTOTPRepository) VerifiedAt() database.Column          { return r.colVer }
func (r *UserTOTPRepository) LastSuccessfulCheck() database.Column { return r.colLastOk }
func (r *UserTOTPRepository) FailedAttempts() database.Column      { return r.colFails }
func (r *UserTOTPRepository) CreatedAt() database.Column           { return r.colCre }
func (r *UserTOTPRepository) UpdatedAt() database.Column           { return r.colUpd }

func (r *UserTOTPRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, pid)
}

func (r *UserTOTPRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(r.UserID(), database.TextOperationEqual, uid)
}

func (r *UserTOTPRepository) PrimaryKeyCondition(pid, uid string) database.Condition {
	return database.And(r.ProjectIDCondition(pid), r.UserIDCondition(uid))
}

func (r *UserTOTPRepository) SetSecret(secret []byte) database.Change {
	return database.NewChange(r.Secret(), secret)
}

func (r *UserTOTPRepository) SetVerifiedAt(t time.Time) database.Change {
	return database.NewChange(r.VerifiedAt(), t)
}

func (r *UserTOTPRepository) SetLastSuccessfulCheck(t time.Time) database.Change {
	return database.NewChange(r.LastSuccessfulCheck(), t)
}

func (r *UserTOTPRepository) IncrementFailedAttempts() database.Change {
	return database.NewChangeToStatement(r.FailedAttempts(), func(b *database.StatementBuilder) {
		r.FailedAttempts().WriteQualified(b)
		b.WriteString(" + 1")
	})
}

func (r *UserTOTPRepository) ResetFailedAttempts() database.Change {
	return database.NewChange(r.FailedAttempts(), int16(0))
}

func (r *UserTOTPRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserTOTP, error) {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(), r.UserID(), r.Secret(), r.VerifiedAt(), r.LastSuccessfulCheck(),
		r.FailedAttempts(), r.CreatedAt(), r.UpdatedAt(),
	}.WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(builder)
	row, err := getOne[userTOTPRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *UserTOTPRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.UserTOTP, error) {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(), r.UserID(), r.Secret(), r.VerifiedAt(), r.LastSuccessfulCheck(),
		r.FailedAttempts(), r.CreatedAt(), r.UpdatedAt(),
	}.WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(builder)
	rows, err := getMany[userTOTPRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.UserTOTP, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *UserTOTPRepository) Create(ctx context.Context, client database.QueryExecutor, c *domain.CreateUserTOTP) error {
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(" (project_id, user_id, secret) VALUES (")
	builder.WriteArgs(c.ProjectID, c.UserID, c.Secret)
	builder.WriteString(")")
	_, err := client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *UserTOTPRepository) Delete(ctx context.Context, client database.QueryExecutor, cond database.Condition) error {
	_, err := deleteOne(ctx, client, r, cond)
	return err
}

type userTOTPRow struct {
	ProjectID           string                   `db:"project_id"`
	UserID              string                   `db:"user_id"`
	Secret              []byte                   `db:"secret"`
	VerifiedAt          database.Null[time.Time] `db:"verified_at"`
	LastSuccessfulCheck database.Null[time.Time] `db:"last_successful_check"`
	FailedAttempts      int16                    `db:"failed_attempts"`
	CreatedAt           time.Time                `db:"created_at"`
	UpdatedAt           time.Time                `db:"updated_at"`
}

func (row *userTOTPRow) toDomain() *domain.UserTOTP {
	t := &domain.UserTOTP{
		ProjectID:      row.ProjectID,
		UserID:         row.UserID,
		Secret:         append([]byte(nil), row.Secret...),
		FailedAttempts: row.FailedAttempts,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.VerifiedAt.Valid {
		t.VerifiedAt = row.VerifiedAt.V
	}
	if row.LastSuccessfulCheck.Valid {
		v := row.LastSuccessfulCheck.V
		t.LastSuccessfulCheck = &v
	}
	return t
}

var _ domain.UserTOTPRepository = (*UserTOTPRepository)(nil)
