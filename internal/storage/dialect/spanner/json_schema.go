package spanner

import (
	"context"
	"encoding/json"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	jsonSchemasTable         = "json_schemas"
	createJSONSchemaStmt     = `INSERT INTO json_schemas (project_id, url, object_type, payload) VALUES (@p1, @p2, @p3, @p4) THEN RETURN project_id, url, object_type, created_at, payload`
	deleteByIDJSONSchemaStmt = `DELETE FROM json_schemas WHERE project_id = @p1 AND url = @p2`
	jsonSchemaQuery          = "SELECT project_id, url, object_type, created_at, payload FROM json_schemas"
)

var jsonSchemaColumns = []string{
	"project_id", "url", "object_type", "created_at", "payload",
}

type jsonSchemaStatements struct{ statement }

func newJSONSchemaStatements(db queryExecutor) jsonSchemaStatements {
	return jsonSchemaStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateJSONSchema implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) CreateJSONSchema(ctx context.Context, schema *domain.JSONSchema) error {
	if err := ensureManagedID(&schema.URL, domain.PrefixJSONSchema); err != nil {
		return err
	}
	return withTransaction(ctx, js.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createJSONSchemaStmt, schema.ProjectID, schema.URL, schema.ObjectType, encodeJSONSchemaPayload(schema.Schema)).statement()
		if err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				scanned, err := js.scanJSONSchema(row)
				if err != nil {
					return struct{}{}, err
				}
				*schema = *scanned
				return struct{}{}, nil
			})
			return err
		}); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindSchema, schema.ProjectID, schema.URL))
	})
}

// DeleteJSONSchemaByID implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) DeleteJSONSchemaByID(ctx context.Context, projectID, schemaID string) error {
	return withTransaction(ctx, js.db, func(ctx context.Context, tx queryExecutor) error {
		n, err := tx.Update(ctx, buildStatement(deleteByIDJSONSchemaStmt, projectID, schemaID).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.DeleteResourceScope(ctx, domain.ResourceKindSchema, projectID, schemaID)
	})
}

// GetJSONSchemaByID implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*domain.JSONSchema, error) {
	row, err := js.db.ReadRow(ctx, jsonSchemasTable, spanner.Key{projectID, schemaID}, jsonSchemaColumns)
	if err != nil {
		return nil, err
	}
	return js.scanJSONSchema(row)
}

// ListJSONSchemas implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) ListJSONSchemas(ctx context.Context, filter *database.ListOptions[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, jsonSchemaQuery, filter, jsonSchemaSchema); err != nil {
		return nil, err
	}

	var schemas []*domain.JSONSchema
	err := js.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		schemas, err = collectRows(iter, js.scanJSONSchema)
		return err
	})
	if err != nil {
		return nil, err
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		schemas,
		jsonSchemaSchema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.JSONSchema]{
		Items:      schemas,
		NextCursor: nextCursor,
	}, nil
}

func (js jsonSchemaStatements) scanJSONSchema(row *spanner.Row) (*domain.JSONSchema, error) {
	schema := new(domain.JSONSchema)
	var payload spanner.NullJSON
	if err := row.Columns(&schema.ProjectID, &schema.URL, &schema.ObjectType, &schema.CreatedAt, &payload); err != nil {
		return nil, err
	}
	data, err := decodeJSONSchemaPayload(payload)
	if err != nil {
		return nil, err
	}
	schema.Schema = data
	return schema, nil
}

func encodeJSONSchemaPayload(b []byte) any {
	if len(b) == 0 {
		return spanner.NullJSON{Valid: false}
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return spanner.NullJSON{Value: string(b), Valid: true}
	}
	return spanner.NullJSON{Value: v, Valid: true}
}

func decodeJSONSchemaPayload(payload spanner.NullJSON) ([]byte, error) {
	if !payload.Valid {
		return nil, nil
	}
	return json.Marshal(payload.Value)
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
