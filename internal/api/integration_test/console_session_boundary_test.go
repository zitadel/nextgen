//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/zitadel/v5/api/generated"
	internalapi "github.com/zitadel/zitadel/v5/internal/api"
	"github.com/zitadel/zitadel/v5/internal/api/integration_test/helpers"
	"github.com/zitadel/zitadel/v5/internal/api/integration_test/test_data"
)

// consoleCall sends one request with the session cookie, and the CSRF token on
// writes as the Console does, and returns the status and body.
func consoleCall(t *testing.T, cookie *http.Cookie, method, path, body string) (int, string) {
	t.Helper()
	var headers map[string]string
	if method != http.MethodGet {
		headers = map[string]string{internalapi.CSRFHeader: internalapi.CSRFToken(cookie.Value)}
	}
	return cookieRequest(t, cookie, method, path, body, headers)
}

// unknownLike returns an id of the same prefix and length as id that names
// nothing, so a lookup miss cannot differ from a denial by id shape.
func unknownLike(id string) string {
	i := strings.LastIndex(id, "_")
	return id[:i+1] + strings.Repeat("0", len(id)-i-1)
}

// TestConsoleSessionForeignTargetIsIndistinguishable pins ADR 053 §7 / #1300
// step 7: for a signed-in user with no foothold in a project, every endpoint
// the Console calls answers a real target in that project exactly as it
// answers one that does not exist -- same status, same body -- so a session
// cannot probe which projects or resources exist.
func TestConsoleSessionForeignTargetIsIndistinguishable(t *testing.T) {
	t.Parallel()

	_, strangerID, cookie := ownSessionUser(t)

	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherUserID, otherTeamID := harness.CreateUserOwnedByTeam(t, other.ID)
	grant := harness.SeedProjectViewer(t, other.ID, otherUserID)

	otherSecret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherSecret, other)

	var schemaObj map[string]any
	require.NoError(t, json.Unmarshal([]byte(harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema), &schemaObj))
	delete(schemaObj, "$id")
	schemaJSON, err := json.Marshal(schemaObj)
	require.NoError(t, err)
	schemaID := harness.CreateUserSchema(t, other, string(schemaJSON))

	listedFlows, err := otherSecret.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: api.ProjectID(other.ID)})
	require.NoError(t, err)
	flows, ok := listedFlows.(*api.FlowDefinitionListResponse)
	require.True(t, ok, helpers.MustMarshal(t, listedFlows))
	require.NotEmpty(t, flows.FlowDefinitions)
	flowID := flows.FlowDefinitions[0].ID

	created, err := otherSecret.CreateBranding(t.Context(), &api.Branding{
		Layout: api.NewOptBrandingLayout(api.BrandingLayoutSplit),
	}, api.CreateBrandingParams{ProjectID: api.ProjectID(other.ID)})
	require.NoError(t, err)
	revision, ok := created.(*api.BrandingRevisionResponse)
	require.True(t, ok, helpers.MustMarshal(t, created))
	brandingID := revision.ID

	proj, noProj := other.ID, unknownLike(other.ID)
	grantBody := `{"principal_type":"user","principal_id":"` + strangerID + `","relation":"viewer"}`
	userBody := helpers.MustMarshal(t, map[string]any{
		"schema":     test_data.UserSchemaURL,
		"attributes": map[string]any{"email": "boundary-" + strangerID + "@example.com", "password": "my-strong-password"},
	})

	tests := []struct {
		name          string
		method        string
		real, unknown string
		body          string
		// wantStatus defaults to 404. Creates whose target project is
		// missing keep their ADR 033 writeMiss shape (400 "project does not
		// exist"), which is the same answer for an unknown project.
		wantStatus int
	}{
		// By id: a foreign resource vs an id that names nothing.
		{"get user", http.MethodGet, "/users/" + otherUserID, "/users/" + unknownLike(otherUserID), "", 0},
		{"delete user", http.MethodDelete, "/users/" + otherUserID, "/users/" + unknownLike(otherUserID), "", 0},
		{"get team", http.MethodGet, "/teams/" + otherTeamID, "/teams/" + unknownLike(otherTeamID), "", 0},
		{"update team", http.MethodPatch, "/teams/" + otherTeamID, "/teams/" + unknownLike(otherTeamID), `{"name":"x"}`, 0},
		{"get schema", http.MethodGet, "/schemas/" + schemaID, "/schemas/" + unknownLike(schemaID), "", 0},
		{"get schema with project hint", http.MethodGet, "/schemas/" + schemaID + "?project_id=" + proj, "/schemas/" + schemaID + "?project_id=" + noProj, "", 0},
		{"get flow definition", http.MethodGet, "/flow_definitions/" + flowID, "/flow_definitions/" + unknownLike(flowID), "", 0},
		{"get branding", http.MethodGet, "/branding/" + brandingID, "/branding/" + unknownLike(brandingID), "", 0},
		{"get grant", http.MethodGet, "/grants/" + grant.ID + "?project_id=" + proj, "/grants/" + unknownLike(grant.ID) + "?project_id=" + noProj, "", 0},
		{"delete grant", http.MethodDelete, "/grants/" + grant.ID + "?project_id=" + proj, "/grants/" + unknownLike(grant.ID) + "?project_id=" + noProj, "", 0},
		// Project-scoped: a foreign project vs a project that does not exist.
		{"get project", http.MethodGet, "/projects/" + proj, "/projects/" + noProj, "", 0},
		{"patch project", http.MethodPatch, "/projects/" + proj, "/projects/" + noProj, `{"name":"x"}`, 0},
		{"query users", http.MethodPost, "/users/query?project_id=" + proj, "/users/query?project_id=" + noProj, `{}`, 0},
		{"create user", http.MethodPost, "/users?project_id=" + proj, "/users?project_id=" + noProj, userBody, http.StatusBadRequest},
		{"query teams", http.MethodPost, "/teams/query?project_id=" + proj, "/teams/query?project_id=" + noProj, `{}`, 0},
		{"create team", http.MethodPost, "/teams?project_id=" + proj, "/teams?project_id=" + noProj, `{"name":"x"}`, 0},
		{"list schemas", http.MethodGet, "/schemas?project_id=" + proj, "/schemas?project_id=" + noProj, "", 0},
		{"list flow definitions", http.MethodGet, "/flow_definitions?project_id=" + proj, "/flow_definitions?project_id=" + noProj, "", 0},
		{"list branding", http.MethodGet, "/branding?project_id=" + proj, "/branding?project_id=" + noProj, "", 0},
		{"query grants", http.MethodPost, "/grants/query?project_id=" + proj, "/grants/query?project_id=" + noProj, `{}`, 0},
		{"create grant", http.MethodPost, "/grants?project_id=" + proj, "/grants?project_id=" + noProj, grantBody, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			realStatus, realBody := consoleCall(t, cookie, tc.method, tc.real, tc.body)
			unknownStatus, unknownBody := consoleCall(t, cookie, tc.method, tc.unknown, tc.body)

			want := tc.wantStatus
			if want == 0 {
				want = http.StatusNotFound
			}
			assert.Equal(t, want, realStatus, realBody)
			assert.Equal(t, unknownStatus, realStatus)
			assert.JSONEq(t, unknownBody, realBody)
		})
	}
}

// TestConsoleSessionFootholdWithoutPermissionIsForbidden pins the other half
// of ADR 053 §7: once the user holds a grant in the project, the project's
// existence is no secret to them, so a missing permission is an honest 403
// rather than a 404. A viewer reads but does not write.
func TestConsoleSessionFootholdWithoutPermissionIsForbidden(t *testing.T) {
	t.Parallel()

	_, viewerID, cookie := ownSessionUser(t)

	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.SeedProjectViewer(t, other.ID, viewerID)
	otherUserID, otherTeamID := harness.CreateUserOwnedByTeam(t, other.ID)
	grant := harness.SeedProjectViewer(t, other.ID, otherUserID)
	proj := other.ID

	t.Run("reads are allowed", func(t *testing.T) {
		t.Parallel()
		for _, path := range []string{"/users/" + otherUserID, "/teams/" + otherTeamID, "/projects/" + proj} {
			status, body := consoleCall(t, cookie, http.MethodGet, path, "")
			assert.Equal(t, http.StatusOK, status, "%s: %s", path, body)
		}
	})

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"create user", http.MethodPost, "/users?project_id=" + proj, helpers.MustMarshal(t, map[string]any{
			"schema":     test_data.UserSchemaURL,
			"attributes": map[string]any{"email": "foothold-" + viewerID + "@example.com", "password": "my-strong-password"},
		})},
		{"delete user", http.MethodDelete, "/users/" + otherUserID, ""},
		{"update team", http.MethodPatch, "/teams/" + otherTeamID, `{"name":"x"}`},
		{"create team", http.MethodPost, "/teams?project_id=" + proj, `{"name":"x"}`},
		{"patch project", http.MethodPatch, "/projects/" + proj, `{"name":"x"}`},
		{"create grant", http.MethodPost, "/grants?project_id=" + proj, `{"principal_type":"user","principal_id":"` + otherUserID + `","relation":"editor"}`},
		{"delete grant", http.MethodDelete, "/grants/" + grant.ID + "?project_id=" + proj, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			status, body := consoleCall(t, cookie, tc.method, tc.path, tc.body)
			assert.Equal(t, http.StatusForbidden, status, body)
			// A CSRF refusal is a 403 too; this must be the authorization
			// denial (`<resource>.permission_denied`), not the security layer.
			var refusal struct {
				Code string `json:"code"`
			}
			require.NoError(t, json.Unmarshal([]byte(body), &refusal), body)
			assert.True(t, strings.HasSuffix(refusal.Code, ".permission_denied"), body)
		})
	}
}
