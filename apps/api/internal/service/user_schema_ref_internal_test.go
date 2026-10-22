package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// fakeUserSchemas serves schema reads from memory: by id, and by objectType
// as the newest-revision list does.
type fakeUserSchemas []*domain.JSONSchema

func (f fakeUserSchemas) GetJSONSchemaByID(_ context.Context, _, id string) (*domain.JSONSchema, error) {
	for _, schema := range f {
		if schema.URL == id {
			return schema, nil
		}
	}
	return nil, new(database.NoRowFoundError)
}

func (f fakeUserSchemas) ListJSONSchemas(_ context.Context, opts *database.ListOptions[domain.JSONSchemaField], _ JSONSchemaQueryOptions) (*database.ListResult[*domain.JSONSchema], error) {
	out := &database.ListResult[*domain.JSONSchema]{}
	for _, filter := range opts.Filter.(database.AndFilter[domain.JSONSchemaField]).Filters {
		term := filter.(*database.CompareFilter[domain.JSONSchemaField]).Terms[0]
		if term.Column.Field() != domain.JSONSchemaFieldObjectType {
			continue
		}
		for _, schema := range f {
			if schema.ObjectType != nil && *schema.ObjectType == term.Value {
				out.Items = append(out.Items, schema)
			}
		}
	}
	return out, nil
}

// unlistedUserSchemas resolves schema ids but lists no revision.
type unlistedUserSchemas struct{ fakeUserSchemas }

func (unlistedUserSchemas) ListJSONSchemas(context.Context, *database.ListOptions[domain.JSONSchemaField], JSONSchemaQueryOptions) (*database.ListResult[*domain.JSONSchema], error) {
	return &database.ListResult[*domain.JSONSchema]{}, nil
}

func TestResolveUserSchema(t *testing.T) {
	human := &domain.JSONSchema{URL: "https://example.com/user.json", ObjectType: new("human-user")}
	machine := &domain.JSONSchema{URL: "sch_machine", ObjectType: new("machine-user")}
	unparsed := &domain.JSONSchema{URL: "https://example.com/fetched.json"}
	schemas := fakeUserSchemas{human, machine, unparsed}

	tests := []struct {
		name    string
		ref     string
		want    *domain.JSONSchema
		wantErr error
	}{
		{name: "objectType", ref: "human-user", want: human},
		{name: "$id URL", ref: human.URL, want: human},
		{name: "minted id", ref: machine.URL, want: machine},
		{name: "unknown objectType", ref: "visitor", wantErr: domain.ErrJSONSchemaNotFound()},
		{name: "unknown id", ref: "sch_unknown", wantErr: domain.ErrJSONSchemaNotFound()},
		{name: "schema declaring no objectType", ref: unparsed.URL, wantErr: domain.ErrJSONSchemaNotFound()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveUserSchema(t.Context(), schemas, domain.BuiltinSchemaBases{}, "proj", tt.ref)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Same(t, tt.want, got)
		})
	}
}

// A built-in schema's `$id` resolves under whichever base the project stores
// it at, so a flow may name the default schema under a base it was not
// seeded under.
func TestResolveUserSchemaUnderAnotherBuiltinBase(t *testing.T) {
	bases := domain.NewBuiltinSchemaBases("https://schemas.test/builtin/v1", "https://schemas.test/builtin/v0")
	stored := &domain.JSONSchema{URL: "https://schemas.test/builtin/v1/default-human-user.json", ObjectType: new("human-user")}
	schemas := fakeUserSchemas{stored}

	got, err := resolveUserSchema(t.Context(), schemas, bases, "proj", "https://schemas.test/builtin/v0/default-human-user.json")
	require.NoError(t, err)
	assert.Same(t, stored, got)

	_, err = resolveUserSchema(t.Context(), schemas, bases, "proj", "https://schemas.test/builtin/v0/other.json")
	assert.ErrorIs(t, err, domain.ErrJSONSchemaNotFound())
}

func TestSameUserSchema(t *testing.T) {
	v1 := &domain.JSONSchema{URL: "sch_human_v1", ObjectType: new("human-user")}
	v2 := &domain.JSONSchema{URL: "sch_human_v2", ObjectType: new("human-user")}
	staff := &domain.JSONSchema{URL: "https://example.com/staff.json", ObjectType: new("staff-user")}
	unparsed := &domain.JSONSchema{URL: "https://example.com/fetched.json"}
	schemas := fakeUserSchemas{v1, v2, staff, unparsed}

	tests := []struct {
		name    string
		a, b    string
		want    bool
		wantErr error
	}{
		{name: "same id", a: "sch_human_v1", b: "sch_human_v1", want: true},
		{name: "same id needs no read", a: "sch_unknown", b: "sch_unknown", want: true},
		{name: "older revision of the same schema", a: v1.URL, b: v2.URL, want: true},
		{name: "another schema", a: staff.URL, b: v2.URL, want: false},
		{name: "unknown id", a: "sch_unknown", b: v2.URL, wantErr: domain.ErrJSONSchemaNotFound()},
		{name: "schema declaring no objectType", a: unparsed.URL, b: v2.URL, wantErr: domain.ErrJSONSchemaNotFound()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := sameUserSchema(t.Context(), schemas, "proj", tt.a, tt.b)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestUserSchemaRevisionURLs(t *testing.T) {
	v1 := &domain.JSONSchema{URL: "sch_human_v1", ObjectType: new("human-user")}
	v2 := &domain.JSONSchema{URL: "sch_human_v2", ObjectType: new("human-user")}
	staff := &domain.JSONSchema{URL: "https://example.com/staff.json", ObjectType: new("staff-user")}
	schemas := fakeUserSchemas{v1, v2, staff}

	tests := []struct {
		name     string
		stmts    userSchemaStatements
		schemaID string
		want     []string
		wantErr  error
	}{
		{name: "one revision", schemaID: staff.URL, want: []string{staff.URL}},
		{name: "several revisions", schemaID: v2.URL, want: []string{v1.URL, v2.URL}},
		{name: "unknown id", schemaID: "sch_unknown", wantErr: domain.ErrJSONSchemaNotFound()},
		// The id resolves but the listing finds no revision: an empty list
		// would compile to broken SQL in the users read.
		{name: "no revisions listed", stmts: unlistedUserSchemas{schemas}, schemaID: v2.URL, wantErr: domain.ErrInternal(nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stmts := tt.stmts
			if stmts == nil {
				stmts = schemas
			}
			got, err := userSchemaRevisionURLs(t.Context(), stmts, "proj", tt.schemaID)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.ElementsMatch(t, tt.want, got)
		})
	}
}
