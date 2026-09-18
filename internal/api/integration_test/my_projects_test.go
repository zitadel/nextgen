//go:build postgres_integration || spanner_integration

package integration_test

import (
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// sessionClientForUser signs userID into the platform project and returns a
// client carrying that session cookie.
func sessionClientForUser(t *testing.T, userID string) *helpers.ApiClient {
	t.Helper()
	cookie := platformSessionCookie(t, userID)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetSessionToken(cookie.Value)
	return client
}

func listMyProjects(t *testing.T, client *helpers.ApiClient, params api.ListMyProjectsParams) *api.ListMyProjectsResponse {
	t.Helper()
	resp, err := client.ListMyProjects(t.Context(), params)
	require.NoError(t, err)
	headers, ok := resp.(*api.ListMyProjectsResponseHeaders)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, "private, no-store", headers.CacheControl.Value)
	return &headers.Response
}

func myProjectIDs(listed *api.ListMyProjectsResponse) []string {
	ids := make([]string, 0, len(listed.Projects))
	for _, p := range listed.Projects {
		ids = append(ids, p.ID)
	}
	return ids
}

func TestListMyProjects(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	stmts := harness.EnsureServiceDB(t).Statements()

	t.Run("owning team grant", func(t *testing.T) {
		t.Parallel()

		userID, teamID := harness.CreateUserOwnedByTeam(t, platform.ID)
		// seedDefaults stays false in this file: the endpoint reads neither
		// schemas nor flows, and every seeded project leaves rows behind in the
		// shared emulator database that the list-predicate suites pay for.
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(project.ID, teamID)))

		listed := listMyProjects(t, sessionClientForUser(t, userID), api.ListMyProjectsParams{})
		require.Len(t, listed.Projects, 1, helpers.MustMarshal(t, listed))
		assert.Equal(t, project.ID, listed.Projects[0].ID)
		assert.Equal(t, project.Name, listed.Projects[0].Name)
		assert.False(t, listed.NextPageToken.Set)
	})

	t.Run("direct viewer grant on someone else's project", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		harness.SeedProjectViewer(t, project.ID, userID)

		listed := listMyProjects(t, sessionClientForUser(t, userID), api.ListMyProjectsParams{})
		assert.Equal(t, []string{project.ID}, myProjectIDs(listed))
	})

	t.Run("no grants is an empty page", func(t *testing.T) {
		t.Parallel()

		// No project of its own: the other cases already leave projects this
		// user holds no grant on, which is exactly the condition under test.
		userID := harness.CreateUserWithTeam(t, platform.ID)

		listed := listMyProjects(t, sessionClientForUser(t, userID), api.ListMyProjectsParams{})
		assert.Empty(t, listed.Projects)
		assert.False(t, listed.NextPageToken.Set)
	})

	t.Run("revoked grant drops out", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		asgn := harness.SeedProjectViewer(t, project.ID, userID)

		client := sessionClientForUser(t, userID)
		require.Equal(t, []string{project.ID}, myProjectIDs(listMyProjects(t, client, api.ListMyProjectsParams{})))

		require.NoError(t, stmts.RevokeAuthzAssignment(t.Context(), project.ID, asgn.ID))
		assert.Empty(t, listMyProjects(t, client, api.ListMyProjectsParams{}).Projects)
	})

	t.Run("expired grant drops out", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		expired := time.Now().Add(-time.Hour)
		asgn := &domain.AuthzAssignment{
			ProjectID:     project.ID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   userID,
			ObjectType:    "project",
			Relation:      "viewer",
			ExpiresAt:     &expired,
		}
		asgn.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), asgn))

		assert.Empty(t, listMyProjects(t, sessionClientForUser(t, userID), api.ListMyProjectsParams{}).Projects)
	})

	t.Run("deactivating the team drops its grants", func(t *testing.T) {
		t.Parallel()

		// The granting team must not own the user's lifecycle: deactivating an
		// owning team deactivates its users too (ADR 024), and the session would
		// then be refused before the grant lookup, which is the other test.
		userID := harness.CreateUserWithTeam(t, platform.ID)
		granting, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: platform.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)
		require.NoError(t, stmts.UpsertAuthzMembershipEdge(t.Context(),
			domain.NewUserTeamMembershipEdge(platform.ID, granting.ID, userID)))

		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(project.ID, granting.ID)))

		client := sessionClientForUser(t, userID)
		require.Equal(t, []string{project.ID}, myProjectIDs(listMyProjects(t, client, api.ListMyProjectsParams{})))

		changed, err := stmts.DeactivateTeam(t.Context(), platform.ID, granting.ID)
		require.NoError(t, err)
		require.True(t, changed)
		assert.Empty(t, listMyProjects(t, client, api.ListMyProjectsParams{}).Projects)
	})

	t.Run("paging", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		first, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		second, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		harness.SeedProjectViewer(t, first.ID, userID)
		harness.SeedProjectViewer(t, second.ID, userID)

		want := []string{first.ID, second.ID}
		if want[0] > want[1] {
			want[0], want[1] = want[1], want[0]
		}

		client := sessionClientForUser(t, userID)
		page1 := listMyProjects(t, client, api.ListMyProjectsParams{Limit: api.NewOptLimit(1)})
		assert.Equal(t, want[:1], myProjectIDs(page1))
		require.True(t, page1.NextPageToken.Set, helpers.MustMarshal(t, page1))

		page2 := listMyProjects(t, client, api.ListMyProjectsParams{
			Limit:     api.NewOptLimit(1),
			PageToken: api.NewOptPageToken(page1.NextPageToken.Value),
		})
		assert.Equal(t, want[1:], myProjectIDs(page2))

		// The last page was full, so it still carries a token. Following it is
		// what ends the listing, exactly as the response schema says.
		require.True(t, page2.NextPageToken.Set, helpers.MustMarshal(t, page2))
		page3 := listMyProjects(t, client, api.ListMyProjectsParams{
			Limit:     api.NewOptLimit(1),
			PageToken: api.NewOptPageToken(page2.NextPageToken.Value),
		})
		assert.Empty(t, page3.Projects)
		assert.False(t, page3.NextPageToken.Set)
	})

	// Deactivating a user does not revoke the sessions already minted for it
	// (#553), so the endpoint re-reads the user rather than trusting the cookie.
	t.Run("deactivated user is refused", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
		require.NoError(t, err)
		harness.SeedProjectViewer(t, project.ID, userID)

		cookie := platformSessionCookie(t, userID)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		client.SetSessionToken(cookie.Value)
		require.Equal(t, []string{project.ID}, myProjectIDs(listMyProjects(t, client, api.ListMyProjectsParams{})))

		require.NoError(t, stmts.DeactivateUser(t.Context(), platform.ID, userID))

		status, details := getMyProjectsRaw(t, cookie.Value)
		assert.Equal(t, http.StatusUnauthorized, status)
		// Byte for byte what an anonymous cookie gets: a refused session must
		// not reveal that the user exists but is deactivated.
		assert.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
		assert.Equal(t, "Missing or invalid session token.", details.Message)
	})

	t.Run("anonymous session is unauthorized", func(t *testing.T) {
		t.Parallel()

		session := harness.CreateSession(t, platform.ID, time.Hour)
		crypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), platform.ID, domain.EncryptionKeyPurposeToken)
		require.NoError(t, err)
		token, err := session.Token(crypter)
		require.NoError(t, err)

		status, details := getMyProjectsRaw(t, token)
		assert.Equal(t, http.StatusUnauthorized, status)
		assert.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
		assert.Equal(t, "Missing or invalid session token.", details.Message)
	})

	t.Run("no cookie is unauthorized", func(t *testing.T) {
		t.Parallel()

		status, details := getMyProjectsRaw(t, "")
		assert.Equal(t, http.StatusUnauthorized, status)
		assert.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
		assert.Equal(t, "Missing or invalid session token.", details.Message)
	})
}

// getMyProjectsRaw sends the request without the generated client, which
// refuses to send an empty credential.
func getMyProjectsRaw(t *testing.T, sessionToken string) (int, *api.ErrorDetails) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet,
		harness.EnsureTestServer(t).URL+"/users/me/projects", nil)
	require.NoError(t, err)
	if sessionToken != "" {
		req.AddCookie(&http.Cookie{Name: "__nextgen_session", Value: sessionToken})
	}
	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, helpers.MustUnmarshal[api.ErrorDetails](t, raw)
}
