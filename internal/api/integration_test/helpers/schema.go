//go:build integration

package helpers

import (
	"testing"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

const BuiltinSchemaBaseURL = "https://test.example.schemas.com"

func (h *Harness) EnsureSchemaService(t *testing.T) *service.SchemaService {
	t.Helper()
	if h.SchemaService == nil {
		h.SchemaService = service.NewSchemaService(
			h.EnsureDBPool(t),
			h.EnsureSchemaRepo(t),
			h.EnsureSchemaResolver(t),
			h.EnsureSchemaValidator(t),
		)
	}
	return h.SchemaService
}

func (h *Harness) EnsureSchemaRepo(t *testing.T) domain.JSONSchemaRepository {
	t.Helper()
	if h.SchemaRepo == nil {
		h.SchemaRepo = repository.NewJSONSchemaRepository(
			h.EnsureDBPool(t),
		)
	}
	return h.SchemaRepo
}

func (h *Harness) EnsureSchemaResolver(t *testing.T) *domain.JSONSchemaResolver {
	t.Helper()
	if h.SchemaResolver == nil {
		cache, err := lru.New2Q[string, *jsonschema.Schema](100)
		require.NoError(t, err)

		h.SchemaResolver = domain.NewJSONSchemaResolver(
			h.SchemaRepo,
			cache,
			0,
			0,
			h.EnsureHttpClient(t),
			nil,
		)
	}
	return h.SchemaResolver
}

func (h *Harness) EnsureSchemaValidator(t *testing.T) *domain.TenantSchemaValidator {
	t.Helper()
	if h.SchemaValidator == nil {
		schemaValidator, err := domain.NewTenantSchemaValidator(BuiltinSchemaBaseURL)
		require.NoError(t, err)

		h.SchemaValidator = schemaValidator
	}
	return h.SchemaValidator
}

func (h *Harness) CreateUserSchema(t *testing.T, projectID string, schema string) string {
	t.Helper()
	client := h.EnsureAPIClient(t)

	apiSchema := api.UserSchema{}
	err := apiSchema.UnmarshalJSON([]byte(schema))
	require.NoError(t, err)

	req := api.CreateSchemaReq{
		Type:       api.UserSchemaCreateSchemaReq,
		UserSchema: apiSchema,
	}
	params := api.CreateSchemaParams{
		ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(projectID)},
	}

	resp, err := client.CreateSchema(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.CreateSchemaResponse{}, resp)
	return resp.(*api.CreateSchemaResponse).ID
}
