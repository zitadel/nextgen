package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const userPATTable = "zitadel_nextgen.user_pats"

type UserPATRepository struct {
	colProject database.Column
	colToken   database.Column
	colUser    database.Column
	colName    database.Column
	colScopes  database.Column
	colExpires database.Column
	colLast    database.Column
	colCre     database.Column
}

func NewUserPATRepository() *UserPATRepository {
	t := userPATTable
	return &UserPATRepository{
		colProject: database.NewColumn(t, "project_id"),
		colToken:   database.NewColumn(t, "token_id"),
		colUser:    database.NewColumn(t, "user_id"),
		colName:    database.NewColumn(t, "name"),
		colScopes:  database.NewColumn(t, "scopes"),
		colExpires: database.NewColumn(t, "expires_at"),
		colLast:    database.NewColumn(t, "last_used_at"),
		colCre:     database.NewColumn(t, "created_at"),
	}
}

func (r *UserPATRepository) qualifiedTableName() string { return userPATTable }
func (r *UserPATRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.TokenID()}
}

func (r *UserPATRepository) ProjectID() database.Column  { return r.colProject }
func (r *UserPATRepository) TokenID() database.Column    { return r.colToken }
func (r *UserPATRepository) UserID() database.Column     { return r.colUser }
func (r *UserPATRepository) Name() database.Column       { return r.colName }
func (r *UserPATRepository) Scopes() database.Column     { return r.colScopes }
func (r *UserPATRepository) ExpiresAt() database.Column  { return r.colExpires }
func (r *UserPATRepository) LastUsedAt() database.Column { return r.colLast }
func (r *UserPATRepository) CreatedAt() database.Column  { return r.colCre }

func (r *UserPATRepository) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, pid)
}
func (r *UserPATRepository) TokenIDCondition(tid string) database.Condition {
	return database.NewTextCondition(r.TokenID(), database.TextOperationEqual, tid)
}
func (r *UserPATRepository) PrimaryKeyCondition(pid, tid string) database.Condition {
	return database.And(r.ProjectIDCondition(pid), r.TokenIDCondition(tid))
}
func (r *UserPATRepository) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(r.UserID(), database.TextOperationEqual, uid)
}
func (r *UserPATRepository) ExpiresAtCondition(after, before time.Time) database.Condition {
	return database.And(
		database.NewNumberCondition(r.ExpiresAt(), database.NumberOperationGreaterThanOrEqual, after),
		database.NewNumberCondition(r.ExpiresAt(), database.NumberOperationLessThanOrEqual, before),
	)
}

func (r *UserPATRepository) SetLastUsedAt(t time.Time) database.Change {
	return database.NewChange(r.LastUsedAt(), t)
}

func (r *UserPATRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserPAT, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(), r.TokenID(), r.UserID(), r.Name(), r.Scopes(),
		r.ExpiresAt(), r.LastUsedAt(), r.CreatedAt(),
	}.WriteQualified(b)
	b.WriteString(" FROM ")
	b.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(b)
	row, err := getOne[userPATRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *UserPATRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.UserPAT, error) {
	b := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(), r.TokenID(), r.UserID(), r.Name(), r.Scopes(),
		r.ExpiresAt(), r.LastUsedAt(), r.CreatedAt(),
	}.WriteQualified(b)
	b.WriteString(" FROM ")
	b.WriteString(r.qualifiedTableName())
	q := &database.QueryOpts{}
	for _, o := range opts {
		o(q)
	}
	q.Write(b)
	rows, err := getMany[userPATRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.UserPAT, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *UserPATRepository) Create(ctx context.Context, client database.QueryExecutor, p *domain.CreateUserPAT) error {
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(` (project_id, token_id, user_id, name, scopes, expires_at)`)
	builder.WriteString(" VALUES (")
	builder.WriteArgs(p.ProjectID, p.TokenID, p.UserID, p.Name, p.Scopes, p.ExpiresAt)
	builder.WriteString(")")
	_, err := client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *UserPATRepository) Delete(ctx context.Context, client database.QueryExecutor, cond database.Condition) error {
	_, err := deleteOne(ctx, client, r, cond)
	return err
}

type userPATRow struct {
	ProjectID string                   `db:"project_id"`
	TokenID   string                   `db:"token_id"`
	UserID    string                   `db:"user_id"`
	Name      database.Null[string]    `db:"name"`
	Scopes    []string                 `db:"scopes"`
	ExpiresAt database.Null[time.Time] `db:"expires_at"`
	LastUsed  database.Null[time.Time] `db:"last_used_at"`
	CreatedAt time.Time                `db:"created_at"`
}

func (row *userPATRow) toDomain() *domain.UserPAT {
	o := &domain.UserPAT{
		ProjectID: row.ProjectID,
		TokenID:   row.TokenID,
		UserID:    row.UserID,
		Scopes:    append([]string(nil), row.Scopes...),
		CreatedAt: row.CreatedAt,
	}
	if row.Name.Valid {
		o.Name = &row.Name.V
	}
	if row.ExpiresAt.Valid {
		t := row.ExpiresAt.V
		o.ExpiresAt = &t
	}
	if row.LastUsed.Valid {
		t := row.LastUsed.V
		o.LastUsedAt = &t
	}
	return o
}

var _ domain.UserPATRepository = (*UserPATRepository)(nil)
