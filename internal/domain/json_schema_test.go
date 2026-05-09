package domain_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

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

func TestNewJSONSchemaResolver(t *testing.T) {
	mockRepo := domainmock.NewMockJSONSchemaRepository(gomock.NewController(t))

	tests := []struct {
		name      string
		cacheSize int
		wantErr   bool
		errSubstr string
	}{
		{
			name:      "success",
			cacheSize: 128,
			wantErr:   false,
		},
		{
			name:      "invalid size zero",
			cacheSize: 0,
			wantErr:   true,
			errSubstr: "invalid size",
		},
		{
			name:      "invalid size negative",
			cacheSize: -1,
			wantErr:   true,
			errSubstr: "invalid size",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, err := domain.NewJSONSchemaResolver(mockRepo, tt.cacheSize)
			if tt.wantErr {
				require.Error(t, err)
				assert.ErrorContains(t, err, tt.errSubstr)
				require.Nil(t, r)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, r)
		})
	}
}

func TestJSONSchemaResolver_Resolve(t *testing.T) {
	ctx := context.Background()
	const (
		instanceID   = "inst-1"
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
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, simpleURL).Return(pkCond).Times(1)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.JSONSchema{
					Schema: []byte(simpleSchema),
				}, nil).Times(1)

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				opts := domain.JSONSchemaResolverOptions{}
				got1, err := resolver.Resolve(ctx, nil, instanceID, simpleURL, nil, opts)
				require.NoError(t, err)
				require.NotNil(t, got1)

				got2, err := resolver.Resolve(ctx, nil, instanceID, simpleURL, nil, opts)
				require.NoError(t, err)
				require.NotNil(t, got2)
				assert.Same(t, got1, got2)
			},
		},
		{
			name: "database hit without HTTP",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, simpleURL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.JSONSchema{
					Schema: []byte(simpleSchema),
				}, nil)

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				got, err := resolver.Resolve(ctx, nil, instanceID, simpleURL, nil, domain.JSONSchemaResolverOptions{})
				require.NoError(t, err)
				require.NotNil(t, got)
			},
		},
		{
			name: "database miss without HTTP client",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, simpleURL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				_, err = resolver.Resolve(ctx, nil, instanceID, simpleURL, nil, domain.JSONSchemaResolverOptions{})
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
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, srv.URL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
				mockRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.AssignableToTypeOf(&domain.JSONSchema{})).
					DoAndReturn(func(_ context.Context, _ database.QueryExecutor, schema *domain.JSONSchema) error {
						assert.Equal(t, instanceID, schema.InstanceID)
						assert.Equal(t, srv.URL, schema.URL)
						assert.NotNil(t, schema.Schema)
						return nil
					})

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				_, err = resolver.Resolve(ctx, nil, instanceID, srv.URL, nil, domain.JSONSchemaResolverOptions{
					HTTPClient: srv.Client(),
				})
				require.NoError(t, err)
			},
		},
		{
			name: "Get returns non-not-found error",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				dbErr := errors.New("db error")
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, simpleURL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, dbErr)

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				_, err = resolver.Resolve(ctx, nil, instanceID, simpleURL, nil, domain.JSONSchemaResolverOptions{})
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

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				_, err = resolver.Resolve(ctx, nil, instanceID, urlA, nil, domain.JSONSchemaResolverOptions{
					MaxResolveDepth: 1,
				})
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
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, srv.URL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
				mockRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).Return(persistErr)

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				_, err = resolver.Resolve(ctx, nil, instanceID, srv.URL, nil, domain.JSONSchemaResolverOptions{
					HTTPClient: srv.Client(),
				})
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
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, srv.URL).Return(pkCond)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
				mockRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.AssignableToTypeOf(&domain.JSONSchema{})).Return(nil)

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				_, err = resolver.Resolve(ctx, nil, instanceID, srv.URL, nil, domain.JSONSchemaResolverOptions{
					HTTPClient: srv.Client(),
				})
				require.Error(t, err)
			},
		},
		{
			name: "root schema bypasses initial repository lookup",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				got, err := resolver.Resolve(ctx, nil, instanceID, simpleURL, []byte(simpleSchema), domain.JSONSchemaResolverOptions{})
				require.NoError(t, err)
				require.NotNil(t, got)
			},
		},
		{
			name: "invalid root schema payload returns error",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				_, err = resolver.Resolve(ctx, nil, instanceID, simpleURL, []byte(`{"type":`), domain.JSONSchemaResolverOptions{})
				require.Error(t, err)
			},
		},
		{
			name: "root schema with ref still resolves dependencies",
			run: func(t *testing.T, ctrl *gomock.Controller) {
				const (
					rootURL   = "https://example.test/root.json"
					refURL    = "https://example.test/ref.json"
					rootSchema = `{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.test/ref.json"}`
					refSchema  = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}`
				)

				mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
				mockRepo.EXPECT().PrimaryKeyCondition(instanceID, refURL).Return(pkCond).Times(1)
				mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.JSONSchema{
					Schema: []byte(refSchema),
				}, nil).Times(1)

				resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128)
				require.NoError(t, err)

				got, err := resolver.Resolve(ctx, nil, instanceID, rootURL, []byte(rootSchema), domain.JSONSchemaResolverOptions{})
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
