package configfs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

// jsonSchemaSchema binds the fields a schema list may filter and order by.
//
// Each backend keeps its own copy, as the SQL dialects do. SQLName is unused
// here — nothing compiles SQL — but it is filled in so a binding reads the same
// wherever it is defined, and so a diff against a dialect's copy shows only the
// storage difference. The accessors are the part this store actually runs on:
// they are how a filter, an ORDER BY and a keyset cursor are evaluated against
// the struct rather than pushed into a query.
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

// loadJSONSchemas parses every document under `schemas/`.
//
// The file is the schema document exactly as authored, so its own `$id`,
// `objectType` and `kind` are the resource's identity — the same parse the
// create API performs, not a second format to keep in step. A document that
// does not parse fails the read rather than being skipped: a list that silently
// omitted a broken schema would look like the resource was deleted, and the
// operator editing it would have no idea why.
func (s *Store) loadJSONSchemas() ([]*domain.JSONSchema, error) {
	entries, err := s.readDir(schemasDir)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.JSONSchema, 0, len(entries))
	for _, e := range entries {
		schema, err := domain.NewJSONSchema(s.ProjectID(), e.bytes)
		if err != nil {
			return nil, domain.ErrJSONSchemaInvalid().
				WithParent(err).
				WithDetails("file " + e.path + " is not a valid schema document")
		}
		// A schema authored through the API has a server-minted id that the
		// index records; a hand-written document is addressed by the `$id` it
		// declares. Preferring the index keeps a schema that users and flow
		// steps already reference resolvable after it moves into the tree.
		schema.URL = s.resourceID(e, schema.URL)

		// Files carry no creation timestamp, so the document's mtime stands in.
		// It orders revisions and feeds the keyset cursor, both of which only
		// need a stable, monotonic-per-edit value.
		if mod, err := modTime(e.path); err == nil {
			schema.CreatedAt = mod
		}
		out = append(out, schema)
	}
	return out, nil
}

func modTime(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}
	return info.ModTime().UTC(), nil
}

func (s *Statements) CreateJSONSchema(ctx context.Context, entity *domain.JSONSchema) error {
	if !s.config.store.serves(entity.ProjectID) {
		return s.AllStatements.CreateJSONSchema(ctx, entity)
	}
	// A schema may arrive without an `$id`; the dialect mints its identity.
	if err := s.ensureID(&entity.URL, domain.PrefixJSONSchema); err != nil {
		return err
	}
	// Where this document belongs in the tree.
	//
	// The CLI writes its own copy of a schema before uploading it, under its
	// own file name (`default-human-user.json`), and the server has no way to
	// know that name. Choosing one from the object type instead produced a
	// second file for the same schema, and two documents resolving to one id
	// is worse than either name: a list returned the schema twice and a read
	// picked whichever came first.
	//
	// So an existing document for this object type is the document to write.
	// Only when none exists does the object type name a new file.
	name := fileNameForObjectType(s.config.store, entity.ObjectType)
	if name == "" {
		name = fileName(entity.URL)
		if entity.ObjectType != nil && *entity.ObjectType != "" {
			name = fileName(*entity.ObjectType)
		}
	}
	// The document carries the id the server assigned, so the next read finds
	// the same schema under the same id.
	document, err := withID(entity.Schema, "$id", entity.URL)
	if err != nil {
		return err
	}
	entity.Schema = document
	if err := s.config.store.write(schemasDir, name, document); err != nil {
		return err
	}
	return s.config.rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindSchema, entity.ProjectID, entity.URL))
}

// GetJSONSchemaByID implements [service.JSONSchemaStatements].
func (s *Statements) GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*domain.JSONSchema, error) {
	if !s.config.store.serves(projectID) {
		return s.AllStatements.GetJSONSchemaByID(ctx, projectID, schemaID)
	}
	schemas, err := s.config.store.loadJSONSchemas()
	if err != nil {
		return nil, err
	}
	for _, schema := range schemas {
		if schema.URL == schemaID {
			return schema, nil
		}
	}
	return nil, new(database.NoRowFoundError)
}

// ListJSONSchemas implements [service.JSONSchemaStatements].
func (s *Statements) ListJSONSchemas(
	ctx context.Context,
	filter *database.ListOptions[domain.JSONSchemaField],
	opts service.JSONSchemaQueryOptions,
) (*database.ListResult[*domain.JSONSchema], error) {
	// The #838 tripwire, unchanged: a management list that reached storage with
	// no authorization filter must fail rather than return the world. The SQL
	// dialects check this inside compileList; there is no compiler here, so it
	// is checked directly.
	if projectID, ok := projectIDFromFilter(filter.Filter, domain.JSONSchemaFieldProjectID); !ok ||
		!s.config.store.serves(projectID) {
		return s.AllStatements.ListJSONSchemas(ctx, filter, opts)
	}
	if err := authz.RequireManagementListFilter(ctx); err != nil {
		return nil, err
	}

	schemas, err := s.config.store.loadJSONSchemas()
	if err != nil {
		return nil, err
	}

	// Visibility is a SQL question even when content is not: the predicate is an
	// EXISTS over resource_scope_index and authz_assignments, which live in the
	// SQL store. Resolve the authorized ids there, then keep only those.
	visible, err := s.visibleResourceIDs(ctx)
	if err != nil {
		return nil, err
	}
	if visible != nil {
		kept := schemas[:0]
		for _, schema := range schemas {
			if _, ok := visible[schema.URL]; ok {
				kept = append(kept, schema)
			}
		}
		schemas = kept
	}

	if opts.LatestRevisionPerObjectType {
		schemas = latestPerObjectType(schemas)
	}

	return query(schemas, filter, jsonSchemaSchema)
}

// latestPerObjectType keeps the newest document per object type, mirroring the
// `latestRevisionPerObjectType` conjunct the SQL dialects add. A document with
// no object type groups with nothing and is always kept.
func latestPerObjectType(schemas []*domain.JSONSchema) []*domain.JSONSchema {
	newest := make(map[string]*domain.JSONSchema, len(schemas))
	out := make([]*domain.JSONSchema, 0, len(schemas))
	for _, schema := range schemas {
		if schema.ObjectType == nil || *schema.ObjectType == "" {
			out = append(out, schema)
			continue
		}
		prev, ok := newest[*schema.ObjectType]
		if !ok || schema.CreatedAt.After(prev.CreatedAt) {
			newest[*schema.ObjectType] = schema
		}
	}
	for _, schema := range newest {
		out = append(out, schema)
	}
	return out
}

// DeleteJSONSchemaByID implements [service.JSONSchemaStatements].
func (s *Statements) DeleteJSONSchemaByID(ctx context.Context, projectID, schemaID string) error {
	if !s.config.store.serves(projectID) {
		return s.AllStatements.DeleteJSONSchemaByID(ctx, projectID, schemaID)
	}
	schema, err := s.GetJSONSchemaByID(ctx, projectID, schemaID)
	if err != nil {
		return err
	}
	name := schema.URL
	if schema.ObjectType != nil && *schema.ObjectType != "" {
		name = *schema.ObjectType
	}
	if err := s.config.store.remove(schemasDir, fileName(name)); err != nil {
		return err
	}
	return s.config.rsi.DeleteResourceScope(ctx, domain.ResourceKindSchema, projectID, schemaID)
}

// visibleResourceIDs resolves the ids this caller may see, or nil when the
// caller is unrestricted and every row is visible.
func (s *Statements) visibleResourceIDs(ctx context.Context) (map[string]struct{}, error) {
	f, ok := service.AuthzListFilterFromContext(ctx)
	if !ok {
		// Unrestricted or a consumed one-shot skip: RequireManagementListFilter
		// already accepted the request, so there is nothing further to narrow.
		return nil, nil
	}
	ids, err := s.config.resolver.ListAuthzObjectIDs(ctx, f)
	if err != nil {
		return nil, err
	}
	slices.Sort(ids)
	visible := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		visible[id] = struct{}{}
	}
	return visible, nil
}

// schemaFilePath is the on-disk location a schema handle maps to, for tests and
// diagnostics.
func (s *Store) schemaFilePath(handle string) string {
	return filepath.Join(s.root, schemasDir, fileName(handle)+".json")
}

// fileNameForObjectType returns the file already holding this object type, or
// empty when the tree has none. Reading the tree is what lets a create adopt a
// document the CLI authored rather than writing a rival copy beside it.
func fileNameForObjectType(store *Store, objectType *string) string {
	if objectType == nil || *objectType == "" {
		return ""
	}
	entries, err := store.readDir(schemasDir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		var doc struct {
			ObjectType string `json:"objectType"`
		}
		if err := json.Unmarshal(e.bytes, &doc); err != nil {
			continue
		}
		if doc.ObjectType == *objectType {
			return e.name
		}
	}
	return ""
}
