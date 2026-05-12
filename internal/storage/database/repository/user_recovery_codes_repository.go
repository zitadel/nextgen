package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userRecoveryTable = "zitadel_nextgen.user_recovery_codes"

type UserRecoveryCodesRepository struct {
	colProject database.Column
	colUser    database.Column
	colCodes   database.Column
	colLastOk  database.Column
	colFails   database.Column
	colCre     database.Column
	colUpd     database.Column
}

func NewUserRecoveryCodesRepository() *UserRecoveryCodesRepository {
	t := userRecoveryTable
	return &UserRecoveryCodesRepository{
		colProject: database.NewColumn(t, "project_id"),
		colUser:    database.NewColumn(t, "user_id"),
		colCodes:   database.NewColumn(t, "recovery_codes"),
		colLastOk:  database.NewColumn(t, "last_successful_check"),
		colFails:   database.NewColumn(t, "failed_attempts"),
		colCre:     database.NewColumn(t, "created_at"),
		colUpd:     database.NewColumn(t, "updated_at"),
	}
}

func (r *UserRecoveryCodesRepository) qualifiedTableName() string { return userRecoveryTable }
func (r *UserRecoveryCodesRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.UserID()}
}
func (r *UserRecoveryCodesRepository) UpdatedAtColumn() database.Column     { return r.UpdatedAt() }
func (r *UserRecoveryCodesRepository) ProjectID() database.Column           { return r.colProject }
func (r *UserRecoveryCodesRepository) UserID() database.Column              { return r.colUser }
func (r *UserRecoveryCodesRepository) RecoveryCodes() database.Column       { return r.colCodes }
func (r *UserRecoveryCodesRepository) LastSuccessfulCheck() database.Column { return r.colLastOk }
func (r *UserRecoveryCodesRepository) FailedAttempts() database.Column      { return r.colFails }
func (r *UserRecoveryCodesRepository) CreatedAt() database.Column           { return r.colCre }
func (r *UserRecoveryCodesRepository) UpdatedAt() database.Column           { return r.colUpd }

func (r *UserRecoveryCodesRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, pid)
}

func (r *UserRecoveryCodesRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(r.UserID(), database.TextOperationEqual, uid)
}

func (r *UserRecoveryCodesRepository) PrimaryKeyCondition(pid, uid string) database.Condition {
	return database.And(r.ProjectIDCondition(pid), r.UserIDCondition(uid))
}

func (r *UserRecoveryCodesRepository) SetRecoveryCodes(codes []string) database.Change {
	return database.NewChange(r.RecoveryCodes(), codes)
}

func (r *UserRecoveryCodesRepository) SetLastSuccessfulCheck(t *time.Time) database.Change {
	return database.NewChangePtr(r.LastSuccessfulCheck(), t)
}

func (r *UserRecoveryCodesRepository) IncrementFailedAttempts() database.Change {
	return database.NewChangeToStatement(r.FailedAttempts(), func(b *database.StatementBuilder) {
		r.FailedAttempts().WriteQualified(b)
		b.WriteString(" + 1")
	})
}

func (r *UserRecoveryCodesRepository) ResetFailedAttempts() database.Change {
	return database.NewChange(r.FailedAttempts(), int16(0))
}

func (r *UserRecoveryCodesRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserRecoveryCodes, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(), r.UserID(), r.RecoveryCodes(),
		r.LastSuccessfulCheck(), r.FailedAttempts(), r.CreatedAt(), r.UpdatedAt(),
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
		r.ProjectID(), r.UserID(), r.RecoveryCodes(),
		r.LastSuccessfulCheck(), r.FailedAttempts(), r.CreatedAt(), r.UpdatedAt(),
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
