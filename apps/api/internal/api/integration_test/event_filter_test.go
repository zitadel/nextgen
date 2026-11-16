//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestListEventsByRequestAndResourceType pins GET /events's resource type,
// operation and status class filters through the API: each returns exactly
// its events, newest first, page after page.
func TestListEventsByRequestAndResourceType(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: helpers.TeamName()})
	require.NoError(t, err)
	harness.SeedOwningTeam(t, project.ID, team.ID)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	stmts := harness.EnsureServiceDB(t).Statements()
	// request.api events as the request middleware writes them.
	request := func(operationID string, status int) string {
		t.Helper()
		recorded := domain.RequestAPIPayload{OperationID: operationID, Method: "POST", RouteTemplate: operationID, Status: status}
		payload, err := json.Marshal(recorded)
		require.NoError(t, err)
		event := &domain.Event{
			ProjectID: project.ID,
			EventType: domain.EventTypeRequestAPI,
			Category:  domain.EventCategoryRequest,
			Payload:   payload,
		}
		event.OperationID, event.StatusClass = recorded.Indexed()
		require.NoError(t, stmts.InsertEvent(t.Context(), event))
		return event.ID
	}
	// An event on a resource of a type that no other test writes.
	entity := func(eventType domain.EventType, category domain.EventCategory, entityType, payload string) string {
		t.Helper()
		event := &domain.Event{
			ProjectID:  project.ID,
			EventType:  eventType,
			Category:   category,
			EntityType: &entityType,
			EntityID:   new("res_" + entityType),
			Payload:    json.RawMessage(payload),
		}
		require.NoError(t, stmts.InsertEvent(t.Context(), event))
		return event.ID
	}

	created := request("createUser", 201)
	conflict := request("createUser", 409)
	listed := request("listUsers", 200)
	failed := request("createUser", 503)
	unrouted := request("", 404)
	redirected := request("getMyUser", 302)
	conflictAgain := request("createUser", 409)
	widgetMade := entity(domain.EventTypeUserCreated, domain.EventCategoryEntity, "widget", `{}`)
	widgetSignIn := entity(domain.EventTypeAuthCheckSucceeded, domain.EventCategoryAuth, "widget", `{"check_id":"chk_1"}`)
	entity(domain.EventTypeUserCreated, domain.EventCategoryEntity, "gadget", `{}`)

	// Every event of a filter, following the token with pages of two.
	all := func(t *testing.T, params api.ListEventsParams) []string {
		t.Helper()
		params.ProjectID = api.ProjectID(project.ID)
		params.Limit = api.NewOptLimit(2)
		var ids []string
		for pages := 0; ; pages++ {
			require.Less(t, pages, 10, "the list must end")
			resp, err := client.ListEvents(t.Context(), params)
			require.NoError(t, err)
			page, ok := resp.(*api.ListEventsResponse)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			require.LessOrEqual(t, len(page.Events), 2)
			for _, event := range page.Events {
				raw, err := event.MarshalJSON()
				require.NoError(t, err)
				var envelope struct {
					ID string `json:"id"`
				}
				require.NoError(t, json.Unmarshal(raw, &envelope))
				ids = append(ids, envelope.ID)
			}
			token, ok := page.NextPageToken.Get()
			if !ok {
				return ids
			}
			params.PageToken = api.NewOptPageToken(token)
		}
	}
	classes := func(values ...api.ListEventsStatusClassItem) []api.ListEventsStatusClassItem { return values }

	for name, tc := range map[string]struct {
		params api.ListEventsParams
		want   []string
	}{
		"one operation, every class": {
			params: api.ListEventsParams{OperationID: []string{"createUser"}},
			want:   []string{conflictAgain, failed, conflict, created},
		},
		"one operation, failed": {
			params: api.ListEventsParams{
				OperationID: []string{"createUser"},
				StatusClass: classes(api.ListEventsStatusClassItem4xx, api.ListEventsStatusClassItem5xx),
			},
			want: []string{conflictAgain, failed, conflict},
		},
		"several operations": {
			params: api.ListEventsParams{OperationID: []string{"listUsers", "getMyUser"}},
			want:   []string{redirected, listed},
		},
		"failed requests, whatever the operation": {
			params: api.ListEventsParams{StatusClass: classes(api.ListEventsStatusClassItem4xx, api.ListEventsStatusClassItem5xx)},
			want:   []string{conflictAgain, unrouted, failed, conflict},
		},
		"one class": {
			params: api.ListEventsParams{StatusClass: classes(api.ListEventsStatusClassItem3xx)},
			want:   []string{redirected},
		},
		"one resource type, every category": {
			params: api.ListEventsParams{EntityType: api.NewOptString("widget")},
			want:   []string{widgetSignIn, widgetMade},
		},
		"one resource type in one category": {
			params: api.ListEventsParams{EntityType: api.NewOptString("widget"), Category: []api.ListEventsCategoryItem{api.ListEventsCategoryItemAuth}},
			want:   []string{widgetSignIn},
		},
		"an operation beside a type it is not": {
			params: api.ListEventsParams{OperationID: []string{"createUser"}, EventType: []string{string(domain.EventTypeUserCreated)}},
			want:   nil,
		},
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, tc.want, all(t, tc.params))
		})
	}

	t.Run("an unknown status class is refused", func(t *testing.T) {
		status, body := cookieRequest(t, nil, "GET", "/events?project_id="+project.ID+"&status_class=6xx", "",
			map[string]string{"Authorization": "Bearer " + harness.ProjectSecret(t, project)})
		assert.Equal(t, 400, status, body)
	})
}
