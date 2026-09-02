package service

import (
	"context"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// UserRefResolver is the batch resolution port of ADR 058 §4: it hydrates
// user references for a page of user IDs with one batched attribute query —
// list endpoints must not resolve per row. Missing users are simply absent
// from the result; their refs degrade to the user id at the caller.
type UserRefResolver interface {
	ResolveUserRefs(ctx context.Context, projectID string, userIDs []string) (map[string]domain.UserRef, error)
	// ResolveRefsForUsers resolves refs for users the caller already holds
	// fully hydrated (ADR 058 §3a) — one schema-list query, no user query.
	ResolveRefsForUsers(ctx context.Context, projectID string, users []*domain.User) (map[string]domain.UserRef, error)
}

// refSchemaPageSize pages the user-schema listing during ref resolution.
// Projects hold few schemas; paging is correctness, not tuning.
const refSchemaPageSize = 100

// StatementsUserRefResolver resolves refs against the statement surface.
type StatementsUserRefResolver struct {
	Pool StatementPool
}

var _ UserRefResolver = StatementsUserRefResolver{}

// ResolveUserRefs loads the project's user-schema documents (every stored
// revision — users pin the schema URL they were created under, so each
// revision's own designations govern its users), lists the requested users
// in one call hydrating only the designated attribute keys, and maps each
// user through its schema's designations.
func (r StatementsUserRefResolver) ResolveUserRefs(ctx context.Context, projectID string, userIDs []string) (map[string]domain.UserRef, error) {
	userIDs = slices.Compact(slices.Sorted(slices.Values(userIDs)))
	if len(userIDs) == 0 {
		return map[string]domain.UserRef{}, nil
	}

	// Both queries below are nested reads keyed on rows the caller already
	// holds (the page's user ids, the project's schemas) — not management
	// lists — so the authz list-filter tripwire and any inherited filter are
	// deliberately skipped, the same choice GetUser makes (#839).
	ctx = WithAuthzListUnrestricted(ctx)

	documents, attributeKeys, err := r.designatingSchemas(ctx, projectID)
	if err != nil {
		return nil, err
	}

	idFilters := make([]database.Filter[domain.UserField], 0, len(userIDs))
	for _, userID := range userIDs {
		idFilters = append(idFilters, database.Equal(database.Col(domain.UserFieldID), userID))
	}
	listed, err := r.Pool.Statements().ListUsers(ctx, &database.ListOptions[domain.UserField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			database.Or(idFilters...),
		),
		Pagination: database.Page[domain.UserField]{
			Limit: uint32(len(userIDs)),
			OrderBy: database.OrderBy[domain.UserField]{
				Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
				Direction: database.OrderAsc,
			},
		},
	}, UserQueryOptions{AttributeKeys: attributeKeys})
	if err != nil {
		return nil, err
	}

	refs := make(map[string]domain.UserRef, len(listed.Items))
	for _, user := range listed.Items {
		refs[user.ID] = domain.ResolveUserRef(user, documents[user.SchemaURL])
	}
	return refs, nil
}

// ResolveRefsForUsers maps already-listed users through their own schema's
// designations (ADR 058 §3a). The callers' read paths hydrate the full
// attribute document, a superset of the designated keys, so resolution
// needs only the schema documents — one schema-list query per page, zero
// additional user queries (§4: list endpoints must not resolve per row).
// Users whose schema URL has no stored document resolve to a bare id ref.
func (r StatementsUserRefResolver) ResolveRefsForUsers(ctx context.Context, projectID string, users []*domain.User) (map[string]domain.UserRef, error) {
	refs := make(map[string]domain.UserRef, len(users))
	if len(users) == 0 {
		return refs, nil
	}
	// Nested read keyed on rows the caller already holds — not a management
	// list; skip the authz list-filter tripwire like GetUser does (#839).
	documents, _, err := r.designatingSchemas(WithAuthzListUnrestricted(ctx), projectID)
	if err != nil {
		return nil, err
	}
	for _, user := range users {
		refs[user.ID] = domain.ResolveUserRef(user, documents[user.SchemaURL])
	}
	return refs, nil
}

// designatingSchemas returns the project's user-schema documents by URL and
// the union of attribute keys their designations read — the hydration set
// for the batched user query. A user whose schema URL is not stored (or
// designates nothing) resolves to a bare user-id ref.
func (r StatementsUserRefResolver) designatingSchemas(ctx context.Context, projectID string) (map[string][]byte, []string, error) {
	stmts := r.Pool.Statements()
	list := func(cursor []byte) (*database.ListResult[*domain.JSONSchema], error) {
		return stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{
			Filter: database.And(
				database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
				database.Equal(database.Col(domain.JSONSchemaFieldKind), domain.JSONSchemaKindUserSchema.String()),
			),
			Pagination: database.Page[domain.JSONSchemaField]{
				Limit:  refSchemaPageSize,
				Cursor: cursor,
				OrderBy: database.OrderBy[domain.JSONSchemaField]{
					Columns:   []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldURL)},
					Direction: database.OrderAsc,
				},
			},
		}, JSONSchemaQueryOptions{})
	}
	first, err := list(nil)
	if err != nil {
		return nil, nil, err
	}
	documents := make(map[string][]byte)
	var attributeKeys []string
	for schema, err := range first.Iterate(list) {
		if err != nil {
			return nil, nil, err
		}
		documents[schema.URL] = schema.Schema
		for _, key := range domain.DesignatedAttributeKeys(schema.Schema) {
			if !slices.Contains(attributeKeys, key) {
				attributeKeys = append(attributeKeys, key)
			}
		}
	}
	if len(attributeKeys) == 0 {
		// Empty AttributeKeys — nil or not — means "hydrate everything"
		// (UserQueryOptions contract); no designation anywhere means
		// nothing to read, so hydrate a key no property can use and the
		// query returns no attribute rows.
		attributeKeys = []string{""}
	}
	return documents, attributeKeys, nil
}
