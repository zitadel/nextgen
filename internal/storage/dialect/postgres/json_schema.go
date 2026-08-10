package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const createJSONSchemaStmt = `INSERT INTO zitadel_nextgen.json_schemas (project_id, url, object_type, payload) VALUES ($1, $2, $3, $4) RETURNING project_id, url, object_type, created_at, payload`

type jsonSchemaStatements struct{ statement }

func newJSONSchemaStatements(client queryExecutor) jsonSchemaStatements {
	return jsonSchemaStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateJSONSchema implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) CreateJSONSchema(ctx context.Context, schema *domain.JSONSchema) error {
	if err := ensureManagedID(&schema.URL, domain.PrefixJSONSchema); err != nil {
		return err
	}
	return wrapError(js.client.QueryRow(ctx, createJSONSchemaStmt, schema.ProjectID, schema.URL, schema.ObjectType, schema.Schema).
		Scan(&schema.ProjectID, &schema.URL, &schema.ObjectType, &schema.CreatedAt, &schema.Schema))
}

const deleteByIDJSONSchemaStmt = `DELETE FROM zitadel_nextgen.json_schemas WHERE project_id = $1 AND url = $2`

// DeleteJSONSchemaByID implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) DeleteJSONSchemaByID(ctx context.Context, projectID, schemaID string) error {
	_, err := js.client.Exec(ctx, deleteByIDJSONSchemaStmt, projectID, schemaID)
	return wrapError(err)
}

const jsonSchemaQuery = "SELECT project_id, url, object_type, created_at, payload FROM zitadel_nextgen.json_schemas"

// GetJSONSchemaByID implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*domain.JSONSchema, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, jsonSchemaQuery, &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(
			database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
			database.Equal(database.Col(domain.JSONSchemaFieldURL), schemaID),
		),
	}, jsonSchemaSchema); err != nil {
		return nil, err
	}

	rows, err := js.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	schema, err := pgx.CollectExactlyOneRow(rows, js.scanJSONSchema)
	if err != nil {
		return nil, wrapError(err)
	}
	return schema, nil
}

// ListJSONSchemas implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) ListJSONSchemas(ctx context.Context, filter *database.ListOptions[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, jsonSchemaQuery, filter, jsonSchemaSchema); err != nil {
		return nil, err
	}

	rows, err := js.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	schemas, err := pgx.CollectRows(rows, js.scanJSONSchema)
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(schemas) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.JSONSchemaField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  jsonSchemaSchema.ValuesFrom(schemas[len(schemas)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.JSONSchema]{
		Items:      schemas,
		NextCursor: nextCursor,
	}, nil
}

func (js jsonSchemaStatements) scanJSONSchema(row pgx.CollectableRow) (*domain.JSONSchema, error) {
	schema := new(domain.JSONSchema)
	if err := row.Scan(&schema.ProjectID, &schema.URL, &schema.ObjectType, &schema.CreatedAt, &schema.Schema); err != nil {
		return nil, err
	}
	return schema, nil
}

var _ service.JSONSchemaStatements = (*jsonSchemaStatements)(nil)

var jsonSchemaSchema = database.NewSchema(map[domain.JSONSchemaField]database.FieldBinding[domain.JSONSchema]{
	domain.JSONSchemaFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(s *domain.JSONSchema) any { return s.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.JSONSchemaFieldURL: {
		SQLName:  "url",
		Accessor: func(s *domain.JSONSchema) any { return s.URL },
		Coerce:   database.CoerceString,
	},
	domain.JSONSchemaFieldObjectType: {
		SQLName:  "object_type",
		Accessor: func(s *domain.JSONSchema) any { return database.NullableValue(s.ObjectType) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.JSONSchemaFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(s *domain.JSONSchema) any { return s.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
