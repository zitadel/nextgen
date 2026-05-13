package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

type JSONSchemaRepository struct {
	table         string
	now           database.Instruction
	encodePayload func([]byte) any

	columnProjectID database.Column
	columnURL        database.Column
	columnCreatedAt  database.Column
	columnPayload    database.Column
}

func NewJSONSchemaRepository(client database.QueryExecutor) *JSONSchemaRepository {
	const pgTable = "zitadel_nextgen.json_schemas"
	const spannerTable = "json_schemas"

	switch client.(type) {
	case spanner.SpannerPooler:
		return newJSONSchemaRepository(spannerTable, database.CurrentTimestampInstruction, func(b []byte) any { return string(b) })
	case postgres.PostgresPooler:
		return newJSONSchemaRepository(pgTable, database.NowInstruction, func(b []byte) any { return b })
	}
	panic("NewJSONSchemaRepository: unsupported client type")
}

func newJSONSchemaRepository(table string, now database.Instruction, encodePayload func([]byte) any) *JSONSchemaRepository {
	return &JSONSchemaRepository{
		table:            table,
		now:              now,
		encodePayload:    encodePayload,
		columnProjectID: database.NewColumn(table, "project_id"),
		columnURL:        database.NewColumn(table, "url"),
		columnCreatedAt:  database.NewColumn(table, "created_at"),
		columnPayload:    database.NewColumn(table, "payload"),
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
		r.now,
		r.encodePayload(schema.Schema),
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
	ProjectID  string               `db:"project_id"`
	URL        string               `db:"url"`
	CreatedAt  time.Time            `db:"created_at"`
	Payload    JSON[json.RawMessage] `db:"payload"`
}

func (r *jsonSchemaRow) toDomain() *domain.JSONSchema {
	return &domain.JSONSchema{
		ProjectID: r.ProjectID,
		URL:        r.URL,
		CreatedAt:  r.CreatedAt,
		Schema:     []byte(r.Payload.Value),
	}
}

var _ domain.JSONSchemaRepository = (*JSONSchemaRepository)(nil)
