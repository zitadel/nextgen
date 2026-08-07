package domain_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func mustJSONSchemaCache(t *testing.T, size int) *lru.TwoQueueCache[string, *jsonschema.Schema] {
	t.Helper()
	cache, err := lru.New2Q[string, *jsonschema.Schema](size)
	require.NoError(t, err)
	return cache
}

func newTestResolver(t *testing.T, httpClient *http.Client) *domain.JSONSchemaResolver {
	t.Helper()
	return domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, httpClient, nil)
}

func newTestResolverWithDepth(t *testing.T, maxResolveDepth int, httpClient *http.Client) *domain.JSONSchemaResolver {
	t.Helper()
	return domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), maxResolveDepth, 0, httpClient, nil)
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u
}

func TestNewJSONSchemaResolver(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		cache := mustJSONSchemaCache(t, 128)
		r := domain.NewJSONSchemaResolver(cache, 0, 0, nil, nil)
		require.NotNil(t, r)
	})

	t.Run("nil cache panics", func(t *testing.T) {
		assert.Panics(t, func() {
			domain.NewJSONSchemaResolver(nil, 0, 0, nil, nil)
		})
	})
}

func TestJSONSchemaResolver_Resolve(t *testing.T) {
	ctx := context.Background()
	const (
		projectID    = "proj-1"
		simpleURL    = "https://example.test/schemas/simple.json"
		simpleSchema = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}`
	)

	tests := []struct {
		name string
		run  func(t *testing.T, ctrl *gomock.Controller)
	}{
		{
			name: "cache hit",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, simpleURL).Return(&domain.JSONSchema{
					Schema: []byte(simpleSchema),
				}, nil).Times(1)

				resolver := newTestResolver(t, nil)

				got1, err := resolver.Resolve(ctx, store, projectID, simpleURL, nil)
				require.NoError(t, err)
				require.NotNil(t, got1)

				got2, err := resolver.Resolve(ctx, store, projectID, simpleURL, nil)
				require.NoError(t, err)
				require.NotNil(t, got2)
				assert.Same(t, got1, got2)
			},
		},
		{
			name: "database hit without HTTP",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, simpleURL).Return(&domain.JSONSchema{
					Schema: []byte(simpleSchema),
				}, nil)

				resolver := newTestResolver(t, nil)

				got, err := resolver.Resolve(ctx, store, projectID, simpleURL, nil)
				require.NoError(t, err)
				require.NotNil(t, got)
			},
		},
		{
			name: "database miss without HTTP client",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, simpleURL).Return(nil, database.NewNoRowFoundError(nil))

				resolver := newTestResolver(t, nil)

				_, err := resolver.Resolve(ctx, store, projectID, simpleURL, nil)
				require.Error(t, err)
				assert.ErrorContains(t, err, "schema not found")
			},
		},
		{
			name: "database miss fetch via HTTP and persist",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(simpleSchema))
				}))
				t.Cleanup(srv.Close)

				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, srv.URL).Return(nil, database.NewNoRowFoundError(nil))
				store.EXPECT().CreateJSONSchema(gomock.Any(), gomock.AssignableToTypeOf(&domain.JSONSchema{})).
					DoAndReturn(func(_ context.Context, schema *domain.JSONSchema) error {
						assert.Equal(t, projectID, schema.ProjectID)
						assert.Equal(t, srv.URL, schema.URL)
						assert.NotNil(t, schema.Schema)
						return nil
					})

				resolver := newTestResolver(t, srv.Client())

				_, err := resolver.Resolve(ctx, store, projectID, srv.URL, nil)
				require.NoError(t, err)
			},
		},
		{
			name: "Get returns non-not-found error",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				dbErr := errors.New("db error")
				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, simpleURL).Return(nil, dbErr)

				resolver := newTestResolver(t, nil)

				_, err := resolver.Resolve(ctx, store, projectID, simpleURL, nil)
				require.Error(t, err)
				assert.Equal(t, dbErr, err)
			},
		},
		{
			name: "max resolve depth",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				const (
					urlA    = "https://example.test/a.json"
					schemaA = `{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.test/b.json"}`
					schemaB = `{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.test/c.json"}`
				)

				store := domainmock.NewMockJSONSchemaStore(ctrl)

				var getCalls int
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, gomock.Any()).DoAndReturn(
					func(_ context.Context, _, schemaURL string) (*domain.JSONSchema, error) {
						getCalls++
						switch getCalls {
						case 1:
							assert.Equal(t, urlA, schemaURL)
							return &domain.JSONSchema{Schema: []byte(schemaA)}, nil
						case 2:
							return &domain.JSONSchema{Schema: []byte(schemaB)}, nil
						default:
							t.Fatalf("unexpected GetJSONSchemaByID call %d", getCalls)
							return nil, errors.New("unexpected")
						}
					},
				).Times(2)

				resolver := newTestResolverWithDepth(t, 1, nil)

				_, err := resolver.Resolve(ctx, store, projectID, urlA, nil)
				require.Error(t, err)
				assert.ErrorContains(t, err, "max resolve depth")
				assert.Equal(t, 2, getCalls)
			},
		},
		{
			name: "Create fails after HTTP fetch",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				persistErr := errors.New("persist failed")
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(simpleSchema))
				}))
				t.Cleanup(srv.Close)

				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, srv.URL).Return(nil, database.NewNoRowFoundError(nil))
				store.EXPECT().CreateJSONSchema(gomock.Any(), gomock.Any()).Return(persistErr)

				resolver := newTestResolver(t, srv.Client())

				_, err := resolver.Resolve(ctx, store, projectID, srv.URL, nil)
				require.Error(t, err)
				assert.Equal(t, persistErr, err)
			},
		},
		{
			name: "HTTP returns body that is not a valid schema",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					// type keyword expects a string or array, not a boolean.
					_, _ = w.Write([]byte(`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":true}`))
				}))
				t.Cleanup(srv.Close)

				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, srv.URL).Return(nil, database.NewNoRowFoundError(nil))
				store.EXPECT().CreateJSONSchema(gomock.Any(), gomock.AssignableToTypeOf(&domain.JSONSchema{})).Return(nil)

				resolver := newTestResolver(t, srv.Client())

				_, err := resolver.Resolve(ctx, store, projectID, srv.URL, nil)
				require.Error(t, err)
			},
		},
		{
			name: "root schema bypasses initial repository lookup",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				store := domainmock.NewMockJSONSchemaStore(ctrl)
				resolver := newTestResolver(t, nil)

				got, err := resolver.Resolve(ctx, store, projectID, simpleURL, []byte(simpleSchema))
				require.NoError(t, err)
				require.NotNil(t, got)
			},
		},
		{
			name: "invalid root schema payload returns error",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				store := domainmock.NewMockJSONSchemaStore(ctrl)
				resolver := newTestResolver(t, nil)

				_, err := resolver.Resolve(ctx, store, projectID, simpleURL, []byte(`{"type":`))
				require.Error(t, err)
			},
		},
		{
			name: "root schema with ref still resolves dependencies",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				const (
					rootURL    = "https://example.test/root.json"
					refURL     = "https://example.test/ref.json"
					rootSchema = `{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.test/ref.json"}`
					refSchema  = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}`
				)

				store := domainmock.NewMockJSONSchemaStore(ctrl)
				store.EXPECT().GetJSONSchemaByID(gomock.Any(), projectID, refURL).Return(&domain.JSONSchema{
					Schema: []byte(refSchema),
				}, nil).Times(1)

				resolver := newTestResolver(t, nil)

				got, err := resolver.Resolve(ctx, store, projectID, rootURL, []byte(rootSchema))
				require.NoError(t, err)
				require.NotNil(t, got)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			tt.run(t, ctrl)
		})
	}
}

func TestWriteBuiltinJSONSchema(t *testing.T) {
	t.Run("writes valid JSON", func(t *testing.T) {
		var buf bytes.Buffer
		canonical := "https://example.test/app/schemas/user-schema.json"
		require.NoError(t, domain.WriteBuiltinJSONSchema(&buf, "user-schema.json", canonical))
		assert.True(t, json.Valid(buf.Bytes()))
		assert.Contains(t, buf.String(), canonical)
	})
	t.Run("unknown schema path", func(t *testing.T) {
		var buf bytes.Buffer
		err := domain.WriteBuiltinJSONSchema(&buf, "nope/not-there.json", "https://example.test/x")
		require.Error(t, err)
	})
	t.Run("relative url", func(t *testing.T) {
		var buf bytes.Buffer
		err := domain.WriteBuiltinJSONSchema(&buf, "user-schema.json", "not-absolute")
		require.Error(t, err)
		assert.ErrorContains(t, err, "must be absolute")
	})
	t.Run("invalid url", func(t *testing.T) {
		var buf bytes.Buffer
		err := domain.WriteBuiltinJSONSchema(&buf, "user-schema.json", "://bad url")
		require.Error(t, err)
		assert.ErrorContains(t, err, "invalid canonicalDocumentURL")
	})
}

func TestJSONSchemaResolver_BuiltinEmbedded(t *testing.T) {
	ctx := context.Background()
	base := mustParseURL(t, "https://example.test/app/schemas")
	full := "https://example.test/app/schemas/user-schema.json"

	t.Run("resolve skips repository", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		store := domainmock.NewMockJSONSchemaStore(ctrl)
		r := domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, nil, base)
		schema, err := r.Resolve(ctx, store, "proj-1", full, nil)
		require.NoError(t, err)
		require.NotNil(t, schema)
	})
	t.Run("URL under base but unknown path falls back to DB and errors when not found", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		store := domainmock.NewMockJSONSchemaStore(ctrl)
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", "https://example.test/app/schemas/unknown/v.json").Return(nil, database.NewNoRowFoundError(nil))
		r := domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, nil, base)
		_, err := r.Resolve(ctx, store, "proj-1", "https://example.test/app/schemas/unknown/v.json", nil)
		require.Error(t, err)
	})
	t.Run("schema URL equals base only falls back to DB and errors when not found", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		store := domainmock.NewMockJSONSchemaStore(ctrl)
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", base.String()).Return(nil, database.NewNoRowFoundError(nil))
		r := domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, nil, base)
		_, err := r.Resolve(ctx, store, "proj-1", base.String(), nil)
		require.Error(t, err)
	})
	t.Run("URL under base but unknown path resolves from DB when found", func(t *testing.T) {
		const userSchemaURL = "https://example.test/app/schemas/user.json"
		const userSchema = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}`
		ctrl := gomock.NewController(t)
		store := domainmock.NewMockJSONSchemaStore(ctrl)
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", userSchemaURL).Return(&domain.JSONSchema{Schema: []byte(userSchema)}, nil)
		r := domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, nil, base)
		schema, err := r.Resolve(ctx, store, "proj-1", userSchemaURL, nil)
		require.NoError(t, err)
		require.NotNil(t, schema)
	})
}

func TestNewJSONSchema_ReservedProperties(t *testing.T) {
	const projectID = "proj-1"

	// The user object carries `id` and `metadata` as system-managed fields
	// (see api/openapi/endpoints/users/user.yaml), so a tenant schema must not
	// declare them itself.
	t.Run("rejected", func(t *testing.T) {
		tests := []struct {
			name    string
			schema  string
			message string
		}{
			{
				name:    "id",
				schema:  `{"type":"object","properties":{"id":{"type":"string"}}}`,
				message: "schema cannot have property id",
			},
			{
				name:    "metadata",
				schema:  `{"type":"object","properties":{"metadata":{"type":"object"}}}`,
				message: "schema cannot have property metadata",
			},
			{
				name:    "id alongside legitimate properties",
				schema:  `{"type":"object","properties":{"email":{"type":"string"},"id":{"type":"string"}}}`,
				message: "schema cannot have property id",
			},
			{
				name:    "metadata alongside legitimate properties",
				schema:  `{"type":"object","properties":{"email":{"type":"string"},"metadata":{"type":"object"}}}`,
				message: "schema cannot have property metadata",
			},
			{
				// id is checked first, so it is the one reported.
				name:    "both reserved properties reports id",
				schema:  `{"type":"object","properties":{"id":{"type":"string"},"metadata":{"type":"object"}}}`,
				message: "schema cannot have property id",
			},
			{
				// The check tests for the key, not for a well-formed subschema.
				name:    "id holding a non-schema value",
				schema:  `{"type":"object","properties":{"id":true}}`,
				message: "schema cannot have property id",
			},
			{
				name:    "metadata holding a non-schema value",
				schema:  `{"type":"object","properties":{"metadata":"reserved"}}`,
				message: "schema cannot have property metadata",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				schema, err := domain.NewJSONSchema(projectID, []byte(tt.schema))
				require.Error(t, err)
				assert.Nil(t, schema)
				assert.ErrorIs(t, err, domain.ErrJSONSchemaInvalid())
				assert.EqualError(t, err, tt.message)
			})
		}
	})

	t.Run("accepted", func(t *testing.T) {
		tests := []struct {
			name   string
			schema string
		}{
			{
				name:   "no properties at all",
				schema: `{"type":"object"}`,
			},
			{
				name:   "empty properties",
				schema: `{"type":"object","properties":{}}`,
			},
			{
				name:   "only customer-defined properties",
				schema: `{"type":"object","properties":{"email":{"type":"string"},"givenName":{"type":"string"}}}`,
			},
			{
				// Only the top level is reserved: a nested object may still
				// carry its own id, e.g. an address with its own identifier.
				name:   "id nested inside another property",
				schema: `{"type":"object","properties":{"address":{"type":"object","properties":{"id":{"type":"string"},"metadata":{"type":"object"}}}}}`,
			},
			{
				// The reserved keys are matched exactly, so differently-cased
				// names remain available to customers.
				name:   "differently cased names",
				schema: `{"type":"object","properties":{"ID":{"type":"string"},"Id":{"type":"string"},"Metadata":{"type":"object"}}}`,
			},
			{
				name:   "names merely containing the reserved words",
				schema: `{"type":"object","properties":{"identifier":{"type":"string"},"metadataUrl":{"type":"string"}}}`,
			},
			{
				// properties is not an object, so there are no keys to reserve;
				// such a schema fails later, at JSON Schema compilation.
				name:   "properties is not an object",
				schema: `{"type":"object","properties":"nonsense"}`,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				schema, err := domain.NewJSONSchema(projectID, []byte(tt.schema))
				require.NoError(t, err)
				require.NotNil(t, schema)
				assert.Equal(t, projectID, schema.ProjectID)
				assert.Equal(t, []byte(tt.schema), schema.Schema)
			})
		}
	})

	t.Run("a reserved key with a null value is not rejected", func(t *testing.T) {
		// Characterisation test, not an endorsement: maputil.Get[any] reports a
		// JSON null as absent, because a type assertion on a nil interface
		// fails. Switching the check to a plain `_, ok := props["id"]` lookup
		// would close this gap — flip these to require.Error if that happens.
		for _, schema := range []string{
			`{"type":"object","properties":{"id":null}}`,
			`{"type":"object","properties":{"metadata":null}}`,
		} {
			got, err := domain.NewJSONSchema(projectID, []byte(schema))
			require.NoError(t, err)
			require.NotNil(t, got)
		}
	})
}

func TestNewJSONSchema_Metadata(t *testing.T) {
	const projectID = "proj-1"

	t.Run("uses $id as the URL when present", func(t *testing.T) {
		schema, err := domain.NewJSONSchema(projectID, []byte(`{"$id":"https://example.test/user.json","type":"object"}`))
		require.NoError(t, err)
		assert.Equal(t, "https://example.test/user.json", schema.URL)
	})

	t.Run("carries objectType through when present", func(t *testing.T) {
		schema, err := domain.NewJSONSchema(projectID, []byte(`{"type":"object","objectType":"human-user"}`))
		require.NoError(t, err)
		require.NotNil(t, schema.ObjectType)
		assert.Equal(t, "human-user", *schema.ObjectType)
	})

	t.Run("leaves objectType nil when absent", func(t *testing.T) {
		schema, err := domain.NewJSONSchema(projectID, []byte(`{"type":"object"}`))
		require.NoError(t, err)
		assert.Nil(t, schema.ObjectType)
	})

	t.Run("rejects a payload that is not JSON", func(t *testing.T) {
		schema, err := domain.NewJSONSchema(projectID, []byte(`{not json`))
		require.Error(t, err)
		assert.Nil(t, schema)
		assert.ErrorIs(t, err, domain.ErrJSONSchemaInvalid())
	})
}
