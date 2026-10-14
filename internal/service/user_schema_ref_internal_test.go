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
			got, err := resolveUserSchema(t.Context(), schemas, "proj", tt.ref)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Same(t, tt.want, got)
		})
	}
}
