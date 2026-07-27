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
	h.schemaService.mutex.Lock()
	defer h.schemaService.mutex.Unlock()

	if h.schemaService.value == nil {
		h.schemaService.value = service.NewSchemaService(
			h.EnsureServiceDB(t),
			h.EnsureSchemaResolver(t),
			h.EnsureSchemaValidator(t),
		)
	}
	return h.schemaService.value
}

func (h *Harness) EnsureSchemaStore(t *testing.T) domain.JSONSchemaStore {
	t.Helper()
	h.schemaStore.mutex.Lock()
	defer h.schemaStore.mutex.Unlock()

	if h.schemaStore.value == nil {
		h.schemaStore.value = h.EnsureServiceDB(t).Statements()
	}
	return h.schemaStore.value
}

func (h *Harness) EnsureSchemaResolver(t *testing.T) *domain.JSONSchemaResolver {
	t.Helper()
	h.schemaResolver.mutex.Lock()
	defer h.schemaResolver.mutex.Unlock()

	if h.schemaResolver.value == nil {
		cache, err := lru.New2Q[string, *jsonschema.Schema](100)
		require.NoError(t, err)

		h.schemaResolver.value = domain.NewJSONSchemaResolver(
			cache,
			0,
			0,
			h.EnsureHttpClient(t),
			mustParseURL(t, BuiltinSchemaBaseURL),
		)
	}
	return h.schemaResolver.value
}

func (h *Harness) EnsureSchemaValidator(t *testing.T) *domain.SchemaValidator {
	t.Helper()
	h.schemaValidator.mutex.Lock()
	defer h.schemaValidator.mutex.Unlock()

	if h.schemaValidator.value == nil {
		schemaValidator, err := domain.NewSchemaValidator(BuiltinSchemaBaseURL)
		require.NoError(t, err)

		h.schemaValidator.value = schemaValidator
	}
	return h.schemaValidator.value
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
