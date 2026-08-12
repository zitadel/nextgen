//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestQuerySessions(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		// Sessions cascade with their project.
		_ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})

	building := harness.CreateSession(t, project.ID, time.Hour)
	expired := harness.CreateSession(t, project.ID, time.Nanosecond)
	userID := harness.CreateUserWithTeam(t, project.ID)
	active := harness.CreateActiveSession(t, project.ID, userID)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetScopedTokenOnApiClient(t, client, project, "session.read")

	querySessions := func(t *testing.T, req *api.QuerySessionsRequest) *api.QuerySessionsResponse {
		t.Helper()
		res, err := client.QuerySessions(t.Context(), req, api.QuerySessionsParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.QuerySessionsResponse{}, res, helpers.MustMarshal(t, res))
		return res.(*api.QuerySessionsResponse)
	}
	sessionIDs := func(sessions []api.SessionResponse) []string {
		ids := make([]string, len(sessions))
		for i, session := range sessions {
			ids[i] = string(session.SessionID)
		}
		return ids
	}

	// expires_at is stamped by the database clock while the state filter
	// compares against the service clock, so wait until the seeded session is
	// observably expired. Expiry is monotonic, so every later query agrees.
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		res, err := client.QuerySessions(t.Context(), &api.QuerySessionsRequest{
			Filter: []api.QuerySessionsRequestFilterItem{{
				Field:     api.SessionFilterFieldState,
				Operation: api.FilterOperationEquals,
				Value:     api.NewOptFilterValue(api.NewStringFilterValue("expired")),
			}},
		}, api.QuerySessionsParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(c, err)
		page, ok := res.(*api.QuerySessionsResponse)
		require.True(c, ok, "unexpected response type %T", res)
		require.Len(c, page.Sessions, 1)
		assert.Equal(c, expired.ID, string(page.Sessions[0].SessionID))
	}, 5*time.Second, 50*time.Millisecond, "the seeded session must become observably expired")

	// The scope matrix and binding anti-oracle live in authz_internal_test.go;
	// this only pins that the endpoint invokes the guard at all.
	t.Run("project secret is denied", func(t *testing.T) {
		denied, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, denied, project)

		res, err := denied.QuerySessions(t.Context(), &api.QuerySessionsRequest{}, api.QuerySessionsParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.QuerySessionsForbidden{}, res, helpers.MustMarshal(t, res))
	})

	t.Run("unfiltered lists every state newest first", func(t *testing.T) {
		ids := sessionIDs(querySessions(t, &api.QuerySessionsRequest{}).Sessions)
		require.ElementsMatch(t, []string{building.ID, expired.ID, active.ID}, ids)
		assert.Equal(t, active.ID, ids[0], "the last-created session must sort first")
	})

	for _, tc := range []struct {
		state string
		want  *domain.Session
	}{
		{state: "building", want: building},
		{state: "expired", want: expired},
		{state: "active", want: active},
	} {
		t.Run("filter by state "+tc.state, func(t *testing.T) {
			sessions := querySessions(t, &api.QuerySessionsRequest{
				Filter: []api.QuerySessionsRequestFilterItem{{
					Field:     api.SessionFilterFieldState,
					Operation: api.FilterOperationEquals,
					Value:     api.NewOptFilterValue(api.NewStringFilterValue(tc.state)),
				}},
			}).Sessions
			require.Len(t, sessions, 1, "state %q must match exactly one of the three seeded sessions: %s",
				tc.state, helpers.MustMarshal(t, sessions))
			assert.Equal(t, tc.want.ID, string(sessions[0].SessionID))
			assert.Equal(t, tc.state, string(sessions[0].State))
		})
	}

	t.Run("filter by user_id", func(t *testing.T) {
		sessions := querySessions(t, &api.QuerySessionsRequest{
			Filter: []api.QuerySessionsRequestFilterItem{{
				Field:     api.SessionFilterFieldUserID,
				Operation: api.FilterOperationEquals,
				Value:     api.NewOptFilterValue(api.NewStringFilterValue(userID)),
			}},
		}).Sessions
		require.Len(t, sessions, 1, helpers.MustMarshal(t, sessions))
		assert.Equal(t, active.ID, string(sessions[0].SessionID))
	})

	t.Run("filter by created_at", func(t *testing.T) {
		createdAtFilter := func(op api.FilterOperation) *api.QuerySessionsRequest {
			return &api.QuerySessionsRequest{
				Filter: []api.QuerySessionsRequestFilterItem{{
					Field:     api.SessionFilterFieldCreatedAt,
					Operation: op,
					Value:     api.NewOptFilterValue(api.NewStringFilterValue(active.CreatedAt.Format(time.RFC3339Nano))),
				}},
			}
		}

		before := querySessions(t, createdAtFilter(api.FilterOperationLessThan)).Sessions
		assert.ElementsMatch(t, []string{building.ID, expired.ID}, sessionIDs(before))

		at := querySessions(t, createdAtFilter(api.FilterOperationEquals)).Sessions
		require.Len(t, at, 1, helpers.MustMarshal(t, at))
		assert.Equal(t, active.ID, string(at[0].SessionID))

		after := querySessions(t, createdAtFilter(api.FilterOperationGreaterThan)).Sessions
		assert.Empty(t, after, helpers.MustMarshal(t, after))
	})

	t.Run("sort by created_at asc lists the newest last", func(t *testing.T) {
		ids := sessionIDs(querySessions(t, &api.QuerySessionsRequest{
			Sorting: api.NewOptQuerySessionsRequestSorting(api.QuerySessionsRequestSorting{
				Field:     api.SessionSortFieldCreatedAt,
				Direction: api.SortDirectionAsc,
			}),
		}).Sessions)
		require.Len(t, ids, 3)
		assert.Equal(t, active.ID, ids[2], "the last-created session must sort last")
	})

	t.Run("pagination walks every session exactly once", func(t *testing.T) {
		got := make([]string, 0, 3)
		req := &api.QuerySessionsRequest{Limit: api.NewOptLimit(1)}
		for range 3 {
			page := querySessions(t, req)
			require.Len(t, page.Sessions, 1)
			got = append(got, string(page.Sessions[0].SessionID))
			token, ok := page.NextPageToken.Get()
			require.True(t, ok, "a full page carries a cursor even when it is the last one")
			req.PageToken = api.NewOptNilPageToken(token)
		}
		assert.ElementsMatch(t, []string{building.ID, expired.ID, active.ID}, got)

		past := querySessions(t, req)
		assert.Empty(t, past.Sessions)
		assert.False(t, past.NextPageToken.Set, "the page past the end reports that there is nothing more")
	})
}
