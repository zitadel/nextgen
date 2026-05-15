package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userTotpTable = "zitadel_nextgen.user_totp"

var (
	colTotpID             = database.NewColumn(userTotpTable, "id")
	colTotpProjectID      = database.NewColumn(userTotpTable, "project_id")
	colTotpUserID         = database.NewColumn(userTotpTable, "user_id")
	colTotpSecret         = database.NewColumn(userTotpTable, "secret")
	colTotpVerifiedAt     = database.NewColumn(userTotpTable, "verified_at")
	colTotpLastSuccessful = database.NewColumn(userTotpTable, "last_successful_check")
	colTotpFailedAttempts = database.NewColumn(userTotpTable, "failed_attempts")
	colTotpCreatedAt      = database.NewColumn(userTotpTable, "created_at")
	colTotpUpdatedAt      = database.NewColumn(userTotpTable, "updated_at")
)

type UserTOTPRepository struct{}

func NewUserTOTPRepository() *UserTOTPRepository {
	return &UserTOTPRepository{}
}

func (r *UserTOTPRepository) qualifiedTableName() string { return userTotpTable }

func (r *UserTOTPRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{colTotpID}
}

func (r *UserTOTPRepository) UniqueKeyColumns() []database.Column {
	return []database.Column{colTotpProjectID, colTotpUserID}
}

func (r *UserTOTPRepository) UpdatedAtColumn() database.Column { return colTotpUpdatedAt }

func (r *UserTOTPRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(colTotpProjectID, database.TextOperationEqual, pid)
}

func (r *UserTOTPRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(colTotpUserID, database.TextOperationEqual, uid)
}

func (r *UserTOTPRepository) PrimaryKeyCondition(id int64) database.Condition {
	return database.NewNumberCondition(colTotpID, database.NumberOperationEqual, id)
}

func (r *UserTOTPRepository) UniqueCondition(pid, uid string) database.Condition {
	return database.And(r.ProjectIDCondition(pid), r.UserIDCondition(uid))
}

func (r *UserTOTPRepository) SetSecret(secret []byte) database.Change {
	return database.NewChange(colTotpSecret, secret)
}

func (r *UserTOTPRepository) SetVerifiedAt(t time.Time) database.Change {
	return database.NewChange(colTotpVerifiedAt, t)
}

func (r *UserTOTPRepository) SetLastSuccessfulCheck(t time.Time) database.Change {
	return database.NewChange(colTotpLastSuccessful, t)
}

func (r *UserTOTPRepository) IncrementFailedAttempts() database.Change {
	return database.NewChangeToStatement(colTotpFailedAttempts, func(b *database.StatementBuilder) {
		colTotpFailedAttempts.WriteQualified(b)
		b.WriteString(" + 1")
	})
}

func (r *UserTOTPRepository) ResetFailedAttempts() database.Change {
	return database.NewChange(colTotpFailedAttempts, int16(0))
}

func (r *UserTOTPRepository) AddFailedAttempts(count int16) database.Change {
	return database.NewChangeToStatement(colTotpFailedAttempts, func(b *database.StatementBuilder) {
		colTotpFailedAttempts.WriteQualified(b)
		b.WriteString(" + ")
		b.WriteArg(count)
	})
}

func (r *UserTOTPRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserTOTP, error) {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		colTotpID, colTotpProjectID, colTotpUserID, colTotpSecret, colTotpVerifiedAt, colTotpLastSuccessful,
		colTotpFailedAttempts, colTotpCreatedAt, colTotpUpdatedAt,
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
		colTotpID, colTotpProjectID, colTotpUserID, colTotpSecret, colTotpVerifiedAt, colTotpLastSuccessful,
		colTotpFailedAttempts, colTotpCreatedAt, colTotpUpdatedAt,
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
	ID                  int64                    `db:"id"`
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
		ID:             row.ID,
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
