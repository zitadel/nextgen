package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createJSONSchemaStmt = `INSERT INTO json_schemas (project_id, url, object_type, payload, created_at)
VALUES (?, ?, ?, ?, ?) RETURNING project_id, url, object_type, created_at, payload`

	deleteByIDJSONSchemaStmt = `DELETE FROM json_schemas WHERE project_id = ? AND url = ?`

	jsonSchemaQuery = `SELECT project_id, url, object_type, created_at, payload FROM json_schemas`
)

type jsonSchemaStatements struct{ statement }

func newJSONSchemaStatements(client queryExecutor) jsonSchemaStatements {
	return jsonSchemaStatements{statement: statement{client: client}}
}

// CreateJSONSchema implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) CreateJSONSchema(ctx context.Context, schema *domain.JSONSchema) error {
	if err := ensureManagedID(&schema.URL, domain.PrefixJSONSchema); err != nil {
		return err
	}
	now := nowUnixNano()
	payload := string(schema.Schema)
	if payload == "" {
		payload = "{}"
	}
	return withTransaction(ctx, js.client, func(ctx context.Context, tx queryExecutor) error {
		row := tx.QueryRow(ctx, createJSONSchemaStmt,
			schema.ProjectID, schema.URL, schema.ObjectType, payload, now,
		)
		scanned, err := scanJSONSchemaRow(row)
		if err != nil {
			return wrapError(err)
		}
		*schema = *scanned
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindSchema, schema.ProjectID, schema.URL))
	})
}

// DeleteJSONSchemaByID implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) DeleteJSONSchemaByID(ctx context.Context, projectID, schemaID string) error {
	return withTransaction(ctx, js.client, func(ctx context.Context, tx queryExecutor) error {
		n, err := execAffected(ctx, tx, deleteByIDJSONSchemaStmt, projectID, schemaID)
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.DeleteResourceScope(ctx, schemaID)
	})
}

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
	defer rows.Close()
	schema, err := collectExactlyOneRow(rows, scanJSONSchema)
	if err != nil {
		return nil, wrapError(err)
	}
	return schema, nil
}

// ListJSONSchemas implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) ListJSONSchemas(ctx context.Context, filter *database.ListOptions[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, jsonSchemaQuery, filter, jsonSchemaSchema, "json_schemas", "url"); err != nil {
		return nil, err
	}
	rows, err := js.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	schemas, err := collectRows(rows, scanJSONSchema)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		schemas,
		jsonSchemaSchema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.JSONSchema]{Items: schemas, NextCursor: nextCursor}, nil
}

func scanJSONSchemaRow(row *sql.Row) (*domain.JSONSchema, error) {
	schema := new(domain.JSONSchema)
	var (
		objectType  sql.NullString
		createdNano int64
		payloadStr  sql.NullString
	)
	if err := row.Scan(&schema.ProjectID, &schema.URL, &objectType, &createdNano, &payloadStr); err != nil {
		return nil, err
	}
	schema.CreatedAt = timeFromUnixNano(createdNano)
	if objectType.Valid {
		v := objectType.String
		schema.ObjectType = &v
	}
	schema.Schema = nullJSONBytes(payloadStr)
	return schema, nil
}

func scanJSONSchema(rows *sql.Rows) (*domain.JSONSchema, error) {
	schema := new(domain.JSONSchema)
	var (
		objectType  sql.NullString
		createdNano int64
		payloadStr  sql.NullString
	)
	if err := rows.Scan(&schema.ProjectID, &schema.URL, &objectType, &createdNano, &payloadStr); err != nil {
		return nil, err
	}
	schema.CreatedAt = timeFromUnixNano(createdNano)
	if objectType.Valid {
		v := objectType.String
		schema.ObjectType = &v
	}
	schema.Schema = nullJSONBytes(payloadStr)
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
