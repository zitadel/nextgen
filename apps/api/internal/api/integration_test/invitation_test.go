//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	api "go.zitadel.com/zitadel/v5/api"
)

func projectMemberInvitation(relation api.InvitationProjectMemberPayloadRelation, name string) api.CreateInvitationProjectMemberRequest {
	req := api.CreateInvitationProjectMemberRequest{
		Type:          api.CreateInvitationProjectMemberRequestTypeProjectMember,
		ProjectMember: api.InvitationProjectMemberPayload{Relation: relation},
	}
	if name != "" {
		req.Metadata = api.NewOptInvitationMetadata(api.InvitationMetadata{Name: name})
	}
	return req
}

func TestInvitationLifecycle(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	claimProject(t, project.ID)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	projectID := api.ProjectID(project.ID)

	create := func(t *testing.T, req api.CreateInvitationProjectMemberRequest) api.CreateInvitationProjectMemberResponse {
		t.Helper()
		resp, err := client.CreateInvitation(t.Context(), api.NewCreateInvitationProjectMemberRequestCreateInvitationRequest(req), api.CreateInvitationParams{ProjectID: projectID})
		require.NoError(t, err)
		created, ok := resp.(*api.CreateInvitationResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		member, ok := created.GetCreateInvitationProjectMemberResponse()
		require.True(t, ok)
		return member
	}
	get := func(t *testing.T, id api.InvitationID) api.GetInvitationRes {
		t.Helper()
		resp, err := client.GetInvitation(t.Context(), api.GetInvitationParams{InvitationID: id, ProjectID: projectID})
		require.NoError(t, err)
		return resp
	}

	t.Run("create, read, list and cancel", func(t *testing.T) {
		t.Parallel()

		created := create(t, projectMemberInvitation(api.InvitationProjectMemberPayloadRelationEditor, "John Doe"))
		assert.True(t, strings.HasPrefix(string(created.ID), "inv_"), created.ID)
		assert.Equal(t, api.InvitationStatusPending, created.Status)
		assert.Equal(t, "John Doe", created.Metadata.Value.Name)
		assert.NotEmpty(t, created.JourneyID)
		// A project secret names no user.
		assert.True(t, created.CreatedBy.IsNull())
		link, err := url.Parse(created.Link)
		require.NoError(t, err)
		assert.Equal(t, "/ui/console/invitations/accept", link.Path)
		assert.Empty(t, link.RawQuery)
		assert.True(t, strings.HasPrefix(link.Fragment, "token="), link.Fragment)

		got, ok := get(t, created.ID).(*api.Invitation)
		require.True(t, ok)
		member, ok := got.GetInvitationProjectMember()
		require.True(t, ok)
		assert.Equal(t, "John Doe", member.Metadata.Value.Name)
		assert.Equal(t, api.InvitationProjectMemberPayloadRelationEditor, member.ProjectMember.Relation)

		listed, err := client.ListInvitations(t.Context(), api.ListInvitationsParams{
			ProjectID: projectID,
			Status:    api.NewOptInvitationStatus(api.InvitationStatusPending),
		})
		require.NoError(t, err)
		page, ok := listed.(*api.ListInvitationsResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		var ids []api.InvitationID
		for _, inv := range page.Invitations {
			ids = append(ids, inv.InvitationProjectMember.ID)
		}
		assert.Contains(t, ids, created.ID)

		cancelled, err := client.CancelInvitation(t.Context(), api.CancelInvitationParams{InvitationID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.CancelInvitationNoContent{}, cancelled, helpers.MustMarshal(t, cancelled))
		require.IsType(t, &api.GetInvitationNotFound{}, get(t, created.ID))

		again, err := client.CancelInvitation(t.Context(), api.CancelInvitationParams{InvitationID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.CancelInvitationNotFound{}, again, helpers.MustMarshal(t, again))

		events := invitationEvents(t, client, projectID, created.ID)
		require.ElementsMatch(t, []string{"invitation.created", "invitation.cancelled"}, eventTypes(events))
		for _, event := range events {
			assert.NotContains(t, string(event.Payload), "John Doe")
		}
	})

	t.Run("replace keeps the journey and moves the metadata", func(t *testing.T) {
		t.Parallel()

		original := create(t, projectMemberInvitation(api.InvitationProjectMemberPayloadRelationViewer, "Jane Doe"))
		req := projectMemberInvitation(api.InvitationProjectMemberPayloadRelationAdmin, "")
		req.ReplacesInvitationID = api.NewOptInvitationID(original.ID)
		replacement := create(t, req)

		assert.NotEqual(t, original.ID, replacement.ID)
		assert.Equal(t, original.JourneyID, replacement.JourneyID)
		assert.Equal(t, "Jane Doe", replacement.Metadata.Value.Name)
		assert.NotEqual(t, original.Link, replacement.Link)
		require.IsType(t, &api.GetInvitationNotFound{}, get(t, original.ID))

		events := invitationEvents(t, client, projectID, original.ID)
		require.ElementsMatch(t, []string{"invitation.created", "invitation.cancelled"}, eventTypes(events))
		for _, event := range events {
			if event.EventType == "invitation.cancelled" {
				assert.JSONEq(t, `{"journey_id":"`+original.JourneyID+`","reason":"replaced","replaced_by_invitation_id":"`+string(replacement.ID)+`"}`, string(event.Payload))
			}
		}
	})

	t.Run("replacing an unknown invitation", func(t *testing.T) {
		t.Parallel()

		req := projectMemberInvitation(api.InvitationProjectMemberPayloadRelationViewer, "")
		req.ReplacesInvitationID = api.NewOptInvitationID("inv_unknown")
		resp, err := client.CreateInvitation(t.Context(), api.NewCreateInvitationProjectMemberRequestCreateInvitationRequest(req), api.CreateInvitationParams{ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.CreateInvitationNotFound{}, resp, helpers.MustMarshal(t, resp))
	})
}

func TestInvitationCreate_UnclaimedProject(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	resp, err := client.CreateInvitation(t.Context(),
		api.NewCreateInvitationProjectMemberRequestCreateInvitationRequest(projectMemberInvitation(api.InvitationProjectMemberPayloadRelationViewer, "")),
		api.CreateInvitationParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	conflict, ok := resp.(*api.CreateInvitationConflict)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, "inv.project_unclaimed", string(conflict.Code))
}

type invitationEvent struct {
	EventType string          `json:"event_type"`
	Payload   json.RawMessage `json:"payload"`
}

// invitationEvents lists the events recorded for one invitation.
func invitationEvents(t *testing.T, client *helpers.ApiClient, projectID api.ProjectID, invitationID api.InvitationID) []invitationEvent {
	t.Helper()
	resp, err := client.ListEvents(t.Context(), api.ListEventsParams{
		ProjectID: projectID,
		EntityID:  api.NewOptString(string(invitationID)),
	})
	require.NoError(t, err)
	page, ok := resp.(*api.ListEventsResponse)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	events := make([]invitationEvent, 0, len(page.Data))
	for _, event := range page.Data {
		raw, err := event.MarshalJSON()
		require.NoError(t, err)
		var decoded invitationEvent
		require.NoError(t, json.Unmarshal(raw, &decoded))
		events = append(events, decoded)
	}
	return events
}

func eventTypes(events []invitationEvent) []string {
	types := make([]string, 0, len(events))
	for _, event := range events {
		types = append(types, event.EventType)
	}
	return types
}
