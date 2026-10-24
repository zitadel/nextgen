package service

import (
	"context"
	"errors"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type userSchemaReader interface {
	GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*domain.JSONSchema, error)
}

type userSchemaStatements interface {
	userSchemaReader
	ListJSONSchemas(ctx context.Context, filter *database.ListOptions[domain.JSONSchemaField], opts JSONSchemaQueryOptions) (*database.ListResult[*domain.JSONSchema], error)
}

// resolveUserSchema returns the project's newest revision of the user schema
// ref names: an objectType, or a schema id (`$id` URL or minted sch_ id) that
// stands for its objectType. A `$id` under one of the built-in bases resolves
// under every base bases knows (domain.BuiltinSchemaBases).
//
// TODO(#536): interim. Latest-wins holds only until the revision is resolved
// from the release the request runs under; only this lookup changes then.
func resolveUserSchema(ctx context.Context, stmts userSchemaStatements, bases domain.BuiltinSchemaBases, projectID, ref string) (*domain.JSONSchema, error) {
	handle := ref
	if isUserSchemaID(ref) {
		objectType, err := schemaObjectType(bases.GetJSONSchema(ctx, stmts, projectID, ref))
		if err != nil {
			return nil, err
		}
		handle = objectType
	}
	result, err := stmts.ListJSONSchemas(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(
			database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
			database.Equal(database.Col(domain.JSONSchemaFieldObjectType), handle),
		),
		Pagination: database.Page[domain.JSONSchemaField]{Limit: 1},
	}, JSONSchemaQueryOptions{LatestRevisionPerObjectType: true})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list schemas from database")
	}
	if len(result.Items) == 0 {
		return nil, domain.ErrJSONSchemaNotFound()
	}
	return result.Items[0], nil
}

// userSchemaObjectType returns the objectType the schema id (`$id` URL or
// minted sch_ id) is a revision of. Every revision of a schema shares it.
func userSchemaObjectType(ctx context.Context, stmts userSchemaReader, projectID, schemaID string) (string, error) {
	return schemaObjectType(stmts.GetJSONSchemaByID(ctx, projectID, schemaID))
}

// schemaObjectType maps a schema read onto the objectType it declares.
func schemaObjectType(schema *domain.JSONSchema, err error) (string, error) {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return "", domain.ErrJSONSchemaNotFound()
	}
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}
	if schema.ObjectType == nil {
		return "", domain.ErrJSONSchemaNotFound()
	}
	return *schema.ObjectType, nil
}

// sameUserSchema reports whether a user's schema id and a flow's schema id are
// revisions of one user schema. A user keeps the revision it was created under
// (users.schema_url) while a flow runs against the newest one, and every
// republish mints a new id, so comparing the ids directly would treat each
// existing user as a user of another schema once the schema changes (#1507:
// users on older revisions keep signing in). Equal ids need no read.
func sameUserSchema(ctx context.Context, stmts userSchemaReader, projectID, userSchemaID, flowSchemaID string) (bool, error) {
	if userSchemaID == flowSchemaID {
		return true, nil
	}
	userType, err := userSchemaObjectType(ctx, stmts, projectID, userSchemaID)
	if err != nil {
		return false, err
	}
	flowType, err := userSchemaObjectType(ctx, stmts, projectID, flowSchemaID)
	if err != nil {
		return false, err
	}
	return userType == flowType, nil
}

// userSchemaRevisionURLs returns the id of every revision of the user schema
// schemaID is a revision of. A user keeps the revision it was created under
// (users.schema_url), so a lookup scoped to one schema must accept them all
// (#1507).
func userSchemaRevisionURLs(ctx context.Context, stmts userSchemaStatements, projectID, schemaID string) ([]string, error) {
	objectType, err := userSchemaObjectType(ctx, stmts, projectID, schemaID)
	if err != nil {
		return nil, err
	}
	list := listUserSchemas(WithAuthzListUnrestricted(ctx), stmts, projectID,
		database.Equal(database.Col(domain.JSONSchemaFieldObjectType), objectType))
	first, err := list(nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list schemas from database")
	}
	var urls []string
	for schema, err := range first.Iterate(list) {
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to list schemas from database")
		}
		urls = append(urls, schema.URL)
	}
	if len(urls) == 0 {
		return nil, domain.ErrInternal(nil).WithMessage("bound user schema has no revisions")
	}
	return urls, nil
}

func isUserSchemaID(ref string) bool {
	if domain.PrefixJSONSchema.Matches(ref) {
		return true
	}
	u, err := url.Parse(ref)
	return err == nil && u.IsAbs()
}
