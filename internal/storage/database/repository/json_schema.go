package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const jsonSchemaTable = "zitadel_nextgen.json_schemas"

type JSONSchemaRepository struct {
	table string

	columnProjectID database.Column
	columnURL       database.Column
	columnCreatedAt database.Column
	columnPayload   database.Column
}

func NewJSONSchemaRepository() *JSONSchemaRepository {
	return &JSONSchemaRepository{
		table:           jsonSchemaTable,
		columnProjectID: database.NewColumn(jsonSchemaTable, "project_id"),
		columnURL:       database.NewColumn(jsonSchemaTable, "url"),
		columnCreatedAt: database.NewColumn(jsonSchemaTable, "created_at"),
		columnPayload:   database.NewColumn(jsonSchemaTable, "payload"),
	}
}

func (r *JSONSchemaRepository) qualifiedTableName() string {
	return r.table
}

func (r *JSONSchemaRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.URL()}
}

func (r *JSONSchemaRepository) ProjectID() database.Column {
	return r.columnProjectID
}

func (r *JSONSchemaRepository) URL() database.Column {
	return r.columnURL
}

func (r *JSONSchemaRepository) CreatedAt() database.Column {
	return r.columnCreatedAt
}

func (r *JSONSchemaRepository) Payload() database.Column {
	return r.columnPayload
}

func (r *JSONSchemaRepository) PrimaryKeyCondition(projectID, url string) database.Condition {
	return database.And(
		r.ProjectIDCondition(projectID),
		r.URLCondition(url),
	)
}

func (r *JSONSchemaRepository) ProjectIDCondition(projectID string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, projectID)
}

func (r *JSONSchemaRepository) URLCondition(url string) database.Condition {
	return database.NewTextCondition(r.URL(), database.TextOperationEqual, url)
}

func (r *JSONSchemaRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.JSONSchema, error) {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(),
		r.URL(),
		r.CreatedAt(),
		r.Payload(),
	}.WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	queryOpts := new(database.QueryOpts)
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)

	row, err := getOne[jsonSchemaRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *JSONSchemaRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.JSONSchema, error) {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(),
		r.URL(),
		r.CreatedAt(),
		r.Payload(),
	}.WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	queryOpts := new(database.QueryOpts)
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)

	rows, err := getMany[jsonSchemaRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	schemas := make([]*domain.JSONSchema, 0, len(rows))
	for _, row := range rows {
		schemas = append(schemas, row.toDomain())
	}
	return schemas, nil
}

func (r *JSONSchemaRepository) Create(ctx context.Context, client database.QueryExecutor, schema *domain.JSONSchema) error {
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(" (")
	database.Columns{
		r.ProjectID(),
		r.URL(),
		r.CreatedAt(),
		r.Payload(),
	}.WriteUnqualified(builder)
	builder.WriteString(") VALUES (")
	builder.WriteArgs(
		schema.ProjectID,
		schema.URL,
		database.NowInstruction,
		schema.Schema,
	)
	builder.WriteString(")")
	_, err := client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *JSONSchemaRepository) Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error {
	_, err := deleteOne(ctx, client, r, condition)
	return err
}

type jsonSchemaRow struct {
	ProjectID string    `db:"project_id"`
	URL       string    `db:"url"`
	CreatedAt time.Time `db:"created_at"`
	Payload   []byte    `db:"payload"`
}

func (r *jsonSchemaRow) toDomain() *domain.JSONSchema {
	return &domain.JSONSchema{
		ProjectID: r.ProjectID,
		URL:       r.URL,
		CreatedAt: r.CreatedAt,
		Schema:    r.Payload,
	}
}

var _ domain.JSONSchemaRepository = (*JSONSchemaRepository)(nil)
