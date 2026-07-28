package helpers

import (
	"net/url"
	"testing"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const BuiltinSchemaBaseURL = "https://test.example.schemas.com/schemas"

func (h *Harness) EnsureSchemaService(t *testing.T) *service.SchemaService {
	t.Helper()
	if h.SchemaService == nil {
		h.SchemaService = service.NewSchemaService(
			h.EnsureServiceDB(t),
			h.EnsureSchemaResolver(t),
			h.EnsureSchemaValidator(t),
		)
	}
	return h.SchemaService
}

func (h *Harness) EnsureSchemaStore(t *testing.T) domain.JSONSchemaStore {
	t.Helper()
	if h.SchemaStore == nil {
		h.SchemaStore = h.EnsureServiceDB(t).Statements()
	}
	return h.SchemaStore
}

func (h *Harness) EnsureSchemaResolver(t *testing.T) *domain.JSONSchemaResolver {
	t.Helper()
	if h.SchemaResolver == nil {
		cache, err := lru.New2Q[string, *jsonschema.Schema](100)
		require.NoError(t, err)

		h.SchemaResolver = domain.NewJSONSchemaResolver(
			cache,
			0,
			0,
			h.EnsureHttpClient(t),
			mustParseURL(t, BuiltinSchemaBaseURL),
		)
	}
	return h.SchemaResolver
}

func (h *Harness) EnsureSchemaValidator(t *testing.T) *domain.SchemaValidator {
	t.Helper()
	if h.SchemaValidator == nil {
		schemaValidator, err := domain.NewSchemaValidator(BuiltinSchemaBaseURL)
		require.NoError(t, err)

		h.SchemaValidator = schemaValidator
	}
	return h.SchemaValidator
}

func (h *Harness) CreateUserSchema(t *testing.T, project *domain.Project, schema string) string {
	t.Helper()
	client, err := NewApiClient(h.EnsureTestServer(t).URL)
	require.NoError(t, err)
	h.SetProjectSecretOnApiClient(t, client, project)

	apiSchema := api.UserSchema{}
	err = apiSchema.UnmarshalJSON([]byte(schema))
	require.NoError(t, err)

	req := api.CreateSchemaReq{
		Type:       api.UserSchemaCreateSchemaReq,
		UserSchema: apiSchema,
	}
	params := api.CreateSchemaParams{
		ProjectID: api.ProjectID(project.ID),
	}

	resp, err := client.CreateSchema(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.CreateSchemaResponse{}, resp, MustMarshal(t, resp))
	return resp.(*api.CreateSchemaResponse).ID
}

func mustParseURL(t *testing.T, s string) *url.URL {
	u, err := url.Parse(s)
	require.NoError(t, err)
	return u
}
