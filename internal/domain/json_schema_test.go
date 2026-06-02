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
	"github.com/zitadel/nextgen/internal/storage/database"
)

// stubCondition is a minimal [database.Condition] for mock expectations.
type stubCondition struct{}

func (stubCondition) Matches(any) bool { return true }

func (stubCondition) String() string { return "stubCondition" }

func (stubCondition) Write(*database.StatementBuilder) {}

func (stubCondition) IsRestrictingColumn(database.Column) bool { return false }

var pkCond stubCondition

func mustJSONSchemaCache(t *testing.T, size int) *lru.TwoQueueCache[string, *jsonschema.Schema] {
	t.Helper()
	cache, err := lru.New2Q[string, *jsonschema.Schema](size)
	require.NoError(t, err)
	return cache
}

func newTestResolver(t *testing.T, repo domain.JSONSchemaRepository, httpClient *http.Client) *domain.JSONSchemaResolver {
	t.Helper()
	return domain.NewJSONSchemaResolver(repo, mustJSONSchemaCache(t, 128), 0, 0, httpClient, nil)
}

func newTestResolverWithDepth(t *testing.T, repo domain.JSONSchemaRepository, maxResolveDepth int, httpClient *http.Client) *domain.JSONSchemaResolver {
	t.Helper()
	return domain.NewJSONSchemaResolver(repo, mustJSONSchemaCache(t, 128), maxResolveDepth, 0, httpClient, nil)
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u
}

func TestNewJSONSchemaResolver(t *testing.T) {
	mockRepo := domainmock.NewMockJSONSchemaRepository(gomock.NewController(t))

	t.Run("success", func(t *testing.T) {
		cache := mustJSONSchemaCache(t, 128)
		r := domain.NewJSONSchemaResolver(mockRepo, cache, 0, 0, nil, nil)
		require.NotNil(t, r)
	})

	t.Run("nil cache panics", func(t *testing.T) {
		assert.Panics(t, func() {
			domain.NewJSONSchemaResolver(mockRepo, nil, 0, 0, nil, nil)
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
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, simpleURL).Return(pkCond).Times(1)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.JSONSchema{
					Schema: []byte(simpleSchema),
				}, nil).Times(1)

				resolver := newTestResolver(t, mockRepo, nil)

				got1, err := resolver.Resolve(ctx, nil, projectID, simpleURL, nil)
				require.NoError(t, err)
				require.NotNil(t, got1)

				got2, err := resolver.Resolve(ctx, nil, projectID, simpleURL, nil)
				require.NoError(t, err)
				require.NotNil(t, got2)
				assert.Same(t, got1, got2)
			},
		},
		{
			name: "database hit without HTTP",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, simpleURL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.JSONSchema{
					Schema: []byte(simpleSchema),
				}, nil)

				resolver := newTestResolver(t, mockRepo, nil)

				got, err := resolver.Resolve(ctx, nil, projectID, simpleURL, nil)
				require.NoError(t, err)
				require.NotNil(t, got)
			},
		},
		{
			name: "database miss without HTTP client",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, simpleURL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

				resolver := newTestResolver(t, mockRepo, nil)

				_, err := resolver.Resolve(ctx, nil, projectID, simpleURL, nil)
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

				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, srv.URL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
				mockRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.AssignableToTypeOf(&domain.JSONSchema{})).
					DoAndReturn(func(_ context.Context, _ database.QueryExecutor, schema *domain.JSONSchema) error {
						assert.Equal(t, projectID, schema.ProjectID)
						assert.Equal(t, srv.URL, schema.URL)
						assert.NotNil(t, schema.Schema)
						return nil
					})

				resolver := newTestResolver(t, mockRepo, srv.Client())

				_, err := resolver.Resolve(ctx, nil, projectID, srv.URL, nil)
				require.NoError(t, err)
			},
		},
		{
			name: "Get returns non-not-found error",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				dbErr := errors.New("db error")
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, simpleURL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, dbErr)

				resolver := newTestResolver(t, mockRepo, nil)

				_, err := resolver.Resolve(ctx, nil, projectID, simpleURL, nil)
				require.Error(t, err)
				assert.Equal(t, dbErr, err)
			},
		},
		{
			name: "max resolve depth",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				const (
					urlA    = "https://example.test/a.json"
					urlB    = "https://example.test/b.json"
					schemaA = `{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.test/b.json"}`
					schemaB = `{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.test/c.json"}`
				)

				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(gomock.Any(), gomock.Any()).Return(pkCond).AnyTimes()

				var getCalls int
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, _ database.QueryExecutor, _ ...database.QueryOption) (*domain.JSONSchema, error) {
						getCalls++
						switch getCalls {
						case 1:
							return &domain.JSONSchema{Schema: []byte(schemaA)}, nil
						case 2:
							return &domain.JSONSchema{Schema: []byte(schemaB)}, nil
						default:
							t.Fatalf("unexpected Get call %d", getCalls)
							return nil, errors.New("unexpected")
						}
					},
				).Times(2)

				resolver := newTestResolverWithDepth(t, mockRepo, 1, nil)

				_, err := resolver.Resolve(ctx, nil, projectID, urlA, nil)
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

				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, srv.URL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
				mockRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).Return(persistErr)

				resolver := newTestResolver(t, mockRepo, srv.Client())

				_, err := resolver.Resolve(ctx, nil, projectID, srv.URL, nil)
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

				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, srv.URL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
				mockRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.AssignableToTypeOf(&domain.JSONSchema{})).Return(nil)

				resolver := newTestResolver(t, mockRepo, srv.Client())

				_, err := resolver.Resolve(ctx, nil, projectID, srv.URL, nil)
				require.Error(t, err)
			},
		},
		{
			name: "root schema bypasses initial repository lookup",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				resolver := newTestResolver(t, mockRepo, nil)

				got, err := resolver.Resolve(ctx, nil, projectID, simpleURL, []byte(simpleSchema))
				require.NoError(t, err)
				require.NotNil(t, got)
			},
		},
		{
			name: "invalid root schema payload returns error",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				resolver := newTestResolver(t, mockRepo, nil)

				_, err := resolver.Resolve(ctx, nil, projectID, simpleURL, []byte(`{"type":`))
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

				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(projectID, refURL).Return(pkCond).Times(1)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.JSONSchema{
					Schema: []byte(refSchema),
				}, nil).Times(1)

				resolver := newTestResolver(t, mockRepo, nil)

				got, err := resolver.Resolve(ctx, nil, projectID, rootURL, []byte(rootSchema))
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
		mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
		r := domain.NewJSONSchemaResolver(mockRepo, mustJSONSchemaCache(t, 128), 0, 0, nil, base)
		schema, err := r.Resolve(ctx, nil, "proj-1", full, nil)
		require.NoError(t, err)
		require.NotNil(t, schema)
	})
	t.Run("URL under base but unknown path falls back to DB and errors when not found", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
		mockRepo.EXPECT().PrimaryKeyCondition("proj-1", "https://example.test/app/schemas/unknown/v.json").Return(pkCond)
		mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		r := domain.NewJSONSchemaResolver(mockRepo, mustJSONSchemaCache(t, 128), 0, 0, nil, base)
		_, err := r.Resolve(ctx, nil, "proj-1", "https://example.test/app/schemas/unknown/v.json", nil)
		require.Error(t, err)
	})
	t.Run("schema URL equals base only falls back to DB and errors when not found", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
		mockRepo.EXPECT().PrimaryKeyCondition("proj-1", base.String()).Return(pkCond)
		mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		r := domain.NewJSONSchemaResolver(mockRepo, mustJSONSchemaCache(t, 128), 0, 0, nil, base)
		_, err := r.Resolve(ctx, nil, "proj-1", base.String(), nil)
		require.Error(t, err)
	})
}
