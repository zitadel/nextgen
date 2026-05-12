package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userRecoveryTable = "zitadel_nextgen.user_recovery_codes"

var (
	colRecoveryProjectID      = database.NewColumn(userRecoveryTable, "project_id")
	colRecoveryUserID         = database.NewColumn(userRecoveryTable, "user_id")
	colRecoveryCodes          = database.NewColumn(userRecoveryTable, "recovery_codes")
	colRecoveryLastSuccessful = database.NewColumn(userRecoveryTable, "last_successful_check")
	colRecoveryFailedAttempts = database.NewColumn(userRecoveryTable, "failed_attempts")
	colRecoveryCreatedAt      = database.NewColumn(userRecoveryTable, "created_at")
	colRecoveryUpdatedAt      = database.NewColumn(userRecoveryTable, "updated_at")
)

type UserRecoveryCodesRepository struct{}

func NewUserRecoveryCodesRepository() *UserRecoveryCodesRepository {
	return &UserRecoveryCodesRepository{}
}

func (r *UserRecoveryCodesRepository) qualifiedTableName() string { return userRecoveryTable }

func (r *UserRecoveryCodesRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{colRecoveryProjectID, colRecoveryUserID}
}

func (r *UserRecoveryCodesRepository) UpdatedAtColumn() database.Column { return colRecoveryUpdatedAt }

func (r *UserRecoveryCodesRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(colRecoveryProjectID, database.TextOperationEqual, pid)
}

func (r *UserRecoveryCodesRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(colRecoveryUserID, database.TextOperationEqual, uid)
}

func (r *UserRecoveryCodesRepository) PrimaryKeyCondition(pid, uid string) database.Condition {
	return database.And(r.ProjectIDCondition(pid), r.UserIDCondition(uid))
}

func (r *UserRecoveryCodesRepository) SetRecoveryCodes(codes []string) database.Change {
	return database.NewChange(colRecoveryCodes, codes)
}

func (r *UserRecoveryCodesRepository) SetLastSuccessfulCheck(t *time.Time) database.Change {
	return database.NewChangePtr(colRecoveryLastSuccessful, t)
}

func (r *UserRecoveryCodesRepository) IncrementFailedAttempts() database.Change {
	return database.NewChangeToStatement(colRecoveryFailedAttempts, func(b *database.StatementBuilder) {
		colRecoveryFailedAttempts.WriteQualified(b)
		b.WriteString(" + 1")
	})
}

func (r *UserRecoveryCodesRepository) ResetFailedAttempts() database.Change {
	return database.NewChange(colRecoveryFailedAttempts, int16(0))
}

func (r *UserRecoveryCodesRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserRecoveryCodes, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		colRecoveryProjectID, colRecoveryUserID, colRecoveryCodes,
		colRecoveryLastSuccessful, colRecoveryFailedAttempts, colRecoveryCreatedAt, colRecoveryUpdatedAt,
	}.WriteQualified(b)
	b.WriteString(" FROM ")
	b.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(b)
	row, err := getOne[userRecoveryRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *UserRecoveryCodesRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.UserRecoveryCodes, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		colRecoveryProjectID, colRecoveryUserID, colRecoveryCodes,
		colRecoveryLastSuccessful, colRecoveryFailedAttempts, colRecoveryCreatedAt, colRecoveryUpdatedAt,
	}.WriteQualified(b)
	b.WriteString(" FROM ")
	b.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(b)
	rows, err := getMany[userRecoveryRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.UserRecoveryCodes, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *UserRecoveryCodesRepository) Create(ctx context.Context, client database.QueryExecutor, c *domain.CreateRecoveryCodes) error {
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(" (project_id, user_id, recovery_codes) VALUES (")
	builder.WriteArgs(c.ProjectID, c.UserID, c.RecoveryCodes)
	builder.WriteString(")")
	_, err := client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *UserRecoveryCodesRepository) Delete(ctx context.Context, client database.QueryExecutor, cond database.Condition) error {
	_, err := deleteOne(ctx, client, r, cond)
	return err
}

type userRecoveryRow struct {
	ProjectID           string                   `db:"project_id"`
	UserID              string                   `db:"user_id"`
	RecoveryCodes       []string                 `db:"recovery_codes"`
	LastSuccessfulCheck database.Null[time.Time] `db:"last_successful_check"`
	FailedAttempts      int16                    `db:"failed_attempts"`
	CreatedAt           time.Time                `db:"created_at"`
	UpdatedAt           time.Time                `db:"updated_at"`
}

func (row *userRecoveryRow) toDomain() *domain.UserRecoveryCodes {
	o := &domain.UserRecoveryCodes{
		ProjectID:      row.ProjectID,
		UserID:         row.UserID,
		RecoveryCodes:  append([]string(nil), row.RecoveryCodes...),
		FailedAttempts: row.FailedAttempts,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.LastSuccessfulCheck.Valid {
		ts := row.LastSuccessfulCheck.V
		o.LastSuccessfulCheck = &ts
	}
	return o
}

var _ domain.UserRecoveryCodesRepository = (*UserRecoveryCodesRepository)(nil)
