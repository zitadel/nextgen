//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

// TestTeamReadsAcceptSession pins #1227: after a claim the Console lands on
// /teams holding only __nextgen_session, so queryTeams and getTeam must accept
// that cookie as a user principal. createTeam and updateTeam joined them with
// #1300 (TestConsoleManagementAcceptsSession); deleteTeam stays secret-only --
// this is not a blanket "sessions may call everything".
//
// The caller is seeded in the post-claim shape (personal team owning the
// project) rather than with a direct user grant, because that is what the
// claim flow actually leaves behind: authority arrives through the team's
// `member from team` rewrite, not a row naming the user.
func TestTeamReadsAcceptSession(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	claimerID, claimerTeamID := harness.CreateUserOwnedByTeam(t, console.ID)
	harness.SeedOwningTeam(t, console.ID, claimerTeamID)

	session := sessionClientForUser(t, claimerID)

	t.Run("queryTeams returns the claimer's team", func(t *testing.T) {
		resp, err := session.QueryTeams(t.Context(), &api.QueryTeamsRequest{},
			api.QueryTeamsParams{ProjectID: api.ProjectID(console.ID)})
		require.NoError(t, err)
		listed, ok := resp.(*api.QueryTeamsResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.True(t, slices.ContainsFunc(listed.Teams, func(team api.TeamResponse) bool {
			return team.ID == claimerTeamID
		}), "the team that owns the project must be in the session-authenticated list")
	})

	t.Run("getTeam returns the claimer's team", func(t *testing.T) {
		resp, err := session.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(claimerTeamID)})
		require.NoError(t, err)
		got, ok := resp.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, claimerTeamID, got.ID)
	})

	t.Run("secret caller is unchanged", func(t *testing.T) {
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)

		resp, err := secret.QueryTeams(t.Context(), &api.QueryTeamsRequest{},
			api.QueryTeamsParams{ProjectID: api.ProjectID(console.ID)})
		require.NoError(t, err)
		listed, ok := resp.(*api.QueryTeamsResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.True(t, slices.ContainsFunc(listed.Teams, func(team api.TeamResponse) bool {
			return team.ID == claimerTeamID
		}))

		getResp, err := secret.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(claimerTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.TeamResponse{}, getResp, helpers.MustMarshal(t, getResp))
	})

	// The allowlist is per-operation: deleteTeam declares oauth2 only, so the
	// generated client cannot even offer the cookie and fails before sending.
	// That pins the spec half -- adding nextgenSession to its security block
	// breaks it.
	t.Run("team delete does not offer the session scheme", func(t *testing.T) {
		_, err := session.DeleteTeam(t.Context(), api.DeleteTeamParams{TeamID: api.TeamID(claimerTeamID)})
		require.Error(t, err, "deleteTeam must not accept the session cookie")
	})

	// ...and the server half, which the generated client cannot reach: a raw
	// request carrying only the cookie must be refused at the security layer,
	// before any handler runs.
	t.Run("team delete refuses a raw session cookie", func(t *testing.T) {
		cookie := platformSessionCookie(t, claimerID).Value
		base := harness.EnsureTestServer(t).URL

		req, err := http.NewRequestWithContext(t.Context(), http.MethodDelete, base+"/teams/"+claimerTeamID, nil)
		require.NoError(t, err)
		req.AddCookie(&http.Cookie{Name: "__nextgen_session", Value: cookie})

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode, "a cookie-only DELETE must be refused")
	})
}

// TestTeamReadsSessionWithoutAccess pins the other half: accepting the cookie
// is not authorizing it. Being signed in is not a grant, so a user whose only
// fact is a personal team reads nothing -- including that team.
func TestTeamReadsSessionWithoutAccess(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	strangerID, strangerTeamID := harness.CreateUserOwnedByTeam(t, console.ID)

	session := sessionClientForUser(t, strangerID)

	otherProject, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	_, foreignTeamID := harness.CreateUserOwnedByTeam(t, otherProject.ID)

	// Membership in a team of the console project is a foothold, so this list
	// is an authorized-but-empty 200 rather than a 403. Empty is the point:
	// the rows a caller sees come from grants, and this caller has none.
	t.Run("sees no teams in the console project without a grant", func(t *testing.T) {
		resp, err := session.QueryTeams(t.Context(), &api.QueryTeamsRequest{},
			api.QueryTeamsParams{ProjectID: api.ProjectID(console.ID)})
		require.NoError(t, err)
		listed, ok := resp.(*api.QueryTeamsResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Empty(t, listed.Teams,
			"a signed-in user with no grant must not see any team, including its own")
	})

	// The foothold decides the shape. This caller is a member of a team in the
	// console project, so the gate answers Forbidden, not the not-found branch
	// the foreign project takes below: 403 team.permission_denied. Pinned by
	// status and code, because "not a TeamResponse" is also true of a 500.
	// getTeam declares no 403 in its spec, hence the generic carrier.
	t.Run("cannot read its own team without a grant", func(t *testing.T) {
		resp, err := session.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(strangerTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetailsStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, 403, denied.StatusCode)
		assert.Equal(t, api.ErrorCode("team.permission_denied"), denied.Response.Code)
	})

	t.Run("cannot read a team in a project it has no foothold in", func(t *testing.T) {
		resp, err := session.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(foreignTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
	})

	// Unlike the console project above, this caller has no foothold here at
	// all, so the list gate takes its not-found branch instead of attaching a
	// filter: a 404, not an empty 200. Required as a type -- a conditional
	// assertion on QueryTeamsResponse never runs, so the subtest would stay
	// green even if a stranger could list a foreign project's teams.
	t.Run("cannot list teams of a project it has no foothold in", func(t *testing.T) {
		resp, err := session.QueryTeams(t.Context(), &api.QueryTeamsRequest{},
			api.QueryTeamsParams{ProjectID: api.ProjectID(otherProject.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.QueryTeamsNotFound{}, resp, helpers.MustMarshal(t, resp))
	})
}
