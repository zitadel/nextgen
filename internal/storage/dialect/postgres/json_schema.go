package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const createJSONSchemaStmt = `INSERT INTO zitadel_nextgen.json_schemas (project_id, url, object_type, kind, payload) VALUES ($1, $2, $3, $4, $5) RETURNING project_id, url, object_type, kind, created_at, payload`

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
	return withTransaction(ctx, js.client, func(ctx context.Context, tx queryExecutor) error {
		var kind string
		if err := tx.QueryRow(ctx, createJSONSchemaStmt, schema.ProjectID, schema.URL, schema.ObjectType, schema.Kind.String(), schema.Schema).
			Scan(&schema.ProjectID, &schema.URL, &schema.ObjectType, &kind, &schema.CreatedAt, &schema.Schema); err != nil {
			return wrapError(err)
		}
		parsedKind, err := domain.JSONSchemaKindString(kind)
		if err != nil {
			return wrapError(err)
		}
		schema.Kind = parsedKind
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindSchema, schema.ProjectID, schema.URL))
	})
}

const deleteByIDJSONSchemaStmt = `DELETE FROM zitadel_nextgen.json_schemas WHERE project_id = $1 AND url = $2`

// DeleteJSONSchemaByID implements [service.JSONSchemaStatements].
func (js jsonSchemaStatements) DeleteJSONSchemaByID(ctx context.Context, projectID, schemaID string) error {
	return withTransaction(ctx, js.client, func(ctx context.Context, tx queryExecutor) error {
		tag, err := tx.Exec(ctx, deleteByIDJSONSchemaStmt, projectID, schemaID)
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.DeleteResourceScope(ctx, domain.ResourceKindSchema, projectID, schemaID)
	})
}

const jsonSchemaQuery = "SELECT project_id, url, object_type, kind, created_at, payload FROM zitadel_nextgen.json_schemas"

// latestRevisionPerObjectType keeps only the newest revision of each
// object_type. It is an anti-join rather than `created_at = (SELECT MAX(…))`
// because the correlation on a NULL object_type is NULL either way: MAX then
// yields NULL and the row is filtered out, while NOT EXISTS passes it through,
// which is what a row that is a revision of nothing deserves.
//
// The uniqueness of (project_id, object_type, created_at) makes created_at a
// total order within an object_type, so no tiebreak belongs in here.
//
// The sub-query deliberately carries no authz predicate, so "newest" is the
// newest revision that exists rather than the newest the caller may read: a
// caller granted only a superseded revision sees it under revisions=all and
// sees nothing for that object type under revisions=latest. Which revision is
// current is a property of the object type, not of the reader, and returning a
// replaced revision as the current one would have callers write against a
// schema their peers have already moved off.
const latestRevisionPerObjectType = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.json_schemas newer` +
	` WHERE newer.project_id = zitadel_nextgen.json_schemas.project_id` +
	` AND newer.object_type = zitadel_nextgen.json_schemas.object_type` +
	` AND newer.created_at > zitadel_nextgen.json_schemas.created_at)`

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
func (js jsonSchemaStatements) ListJSONSchemas(ctx context.Context, filter *database.ListOptions[domain.JSONSchemaField], opts service.JSONSchemaQueryOptions) (*database.ListResult[*domain.JSONSchema], error) {
	var conjuncts []string
	if opts.LatestRevisionPerObjectType {
		conjuncts = append(conjuncts, latestRevisionPerObjectType)
	}

	var compiler statementCompiler
	if err := compileList(ctx, &compiler, jsonSchemaQuery, filter, jsonSchemaSchema, "zitadel_nextgen.json_schemas", "url", conjuncts...); err != nil {
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

func (js jsonSchemaStatements) scanJSONSchema(row pgx.CollectableRow) (*domain.JSONSchema, error) {
	schema := new(domain.JSONSchema)
	var kind string
	if err := row.Scan(&schema.ProjectID, &schema.URL, &schema.ObjectType, &kind, &schema.CreatedAt, &schema.Schema); err != nil {
		return nil, err
	}
	parsedKind, err := domain.JSONSchemaKindString(kind)
	if err != nil {
		return nil, err
	}
	schema.Kind = parsedKind
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
	domain.JSONSchemaFieldKind: {
		SQLName:  "kind",
		Accessor: func(s *domain.JSONSchema) any { return s.Kind.String() },
		Coerce:   database.CoerceString,
	},
})
