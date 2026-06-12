package helpers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

const BuiltinSchemaBaseURL = "https://test.example.schemas.com/schemas"

func (h *Harness) EnsureSchemaService(t *testing.T) *service.SchemaService {
	t.Helper()
	h.mu.Lock()
	svc := h.SchemaService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewSchemaService(
		h.EnsureDBPool(t),
		h.EnsureSchemaRepo(t),
		h.EnsureSchemaResolver(t),
		h.EnsureSchemaValidator(t),
	)
	h.mu.Lock()
	if h.SchemaService == nil {
		h.SchemaService = svc
	}
	svc = h.SchemaService
	h.mu.Unlock()
	return svc
}

func (h *Harness) EnsureSchemaRepo(t *testing.T) domain.JSONSchemaRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.SchemaRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewJSONSchemaRepository(
		h.EnsureDBPool(t),
	)
	h.mu.Lock()
	if h.SchemaRepo == nil {
		h.SchemaRepo = repo
	}
	repo = h.SchemaRepo
	h.mu.Unlock()
	return repo
}

func (h *Harness) EnsureSchemaResolver(t *testing.T) *domain.JSONSchemaResolver {
	t.Helper()
	h.mu.Lock()
	resolver := h.SchemaResolver
	h.mu.Unlock()
	if resolver != nil {
		return resolver
	}

	cache, err := lru.New2Q[string, *jsonschema.Schema](100)
	require.NoError(t, err)
	resolver = domain.NewJSONSchemaResolver(
		h.EnsureSchemaRepo(t),
		cache,
		0,
		0,
		h.EnsureHttpClient(t),
		mustParseURL(t, BuiltinSchemaBaseURL),
	)
	h.mu.Lock()
	if h.SchemaResolver == nil {
		h.SchemaResolver = resolver
	}
	resolver = h.SchemaResolver
	h.mu.Unlock()
	return resolver
}

func (h *Harness) EnsureSchemaValidator(t *testing.T) *domain.SchemaValidator {
	t.Helper()
	h.mu.Lock()
	validator := h.SchemaValidator
	h.mu.Unlock()
	if validator != nil {
		return validator
	}
	validator, err := domain.NewSchemaValidator(BuiltinSchemaBaseURL)
	require.NoError(t, err)
	h.mu.Lock()
	if h.SchemaValidator == nil {
		h.SchemaValidator = validator
	}
	validator = h.SchemaValidator
	h.mu.Unlock()
	return validator
}

func (h *Harness) CreateUserSchema(t *testing.T, projectID string, schema string) string {
	t.Helper()
	return h.createUserSchema(t, projectID, schema, false)
}

func (h *Harness) EnsureUserSchema(t *testing.T, projectID string, schema string) string {
	t.Helper()
	return h.createUserSchema(t, projectID, schema, true)
}

func (h *Harness) EnsureUserSchemaWithID(t *testing.T, projectID string, schema string, schemaID string) string {
	t.Helper()
	return h.EnsureUserSchema(t, projectID, userSchemaWithID(t, schema, schemaID))
}

func (h *Harness) createUserSchema(t *testing.T, projectID string, schema string, allowExisting bool) string {
	t.Helper()
	h.schemaMu.Lock()
	defer h.schemaMu.Unlock()

	schemaID := userSchemaID(t, schema)
	client := h.EnsureAPIClient(t, projectID)

	apiSchema := api.UserSchema{}
	err := apiSchema.UnmarshalJSON([]byte(schema))
	require.NoError(t, err)

	req := api.CreateSchemaReq{
		Type:       api.UserSchemaCreateSchemaReq,
		UserSchema: apiSchema,
	}
	params := api.CreateSchemaParams{
		ProjectID: api.ProjectID(projectID),
	}

	resp, err := client.CreateSchema(t.Context(), req, params)
	require.NoErrorf(t, err, "create schema response: %s", MustMarshal(t, resp))
	if created, ok := resp.(*api.CreateSchemaResponse); ok {
		return created.ID
	}
	if allowExisting && isCreateSchemaConflict(resp) {
		getResp, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
			ID:        schemaID,
			ProjectID: api.ProjectID(projectID),
		})
		require.NoErrorf(t, err, "get existing schema response: %s", MustMarshal(t, getResp))
		require.IsTypef(t, &api.GetSchemaByIdOK{}, getResp, "existing schema response: %s", MustMarshal(t, getResp))
		return schemaID
	}
	require.IsTypef(t, &api.CreateSchemaResponse{}, resp, "create schema response: %s", MustMarshal(t, resp))
	return resp.(*api.CreateSchemaResponse).ID
}

func isCreateSchemaConflict(resp api.CreateSchemaRes) bool {
	switch r := resp.(type) {
	case *api.CreateSchemaConflict:
		return true
	case *api.ErrorDetailsStatusCode:
		return r.StatusCode == http.StatusConflict
	default:
		return false
	}
}

func userSchemaID(t *testing.T, schema string) string {
	t.Helper()
	var body struct {
		ID string `json:"$id"`
	}
	require.NoError(t, json.Unmarshal([]byte(schema), &body))
	require.NotEmpty(t, body.ID)
	return body.ID
}

func userSchemaWithID(t *testing.T, schema string, schemaID string) string {
	t.Helper()
	var body map[string]any
	require.NoError(t, json.Unmarshal([]byte(schema), &body))
	body["$id"] = schemaID
	bs, err := json.Marshal(body)
	require.NoError(t, err)
	return string(bs)
}

func mustParseURL(t *testing.T, s string) *url.URL {
	u, err := url.Parse(s)
	require.NoError(t, err)
	return u
}
