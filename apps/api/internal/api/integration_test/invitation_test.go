//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
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
		resp, err := client.GetInvitation(t.Context(), api.GetInvitationParams{ID: id, ProjectID: projectID})
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
		assert.True(t, created.RejectedAt.IsNull())
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
			Status:    []api.InvitationStatus{api.InvitationStatusPending},
		})
		require.NoError(t, err)
		page, ok := listed.(*api.ListInvitationsResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		var ids []api.InvitationID
		for _, inv := range page.Invitations {
			ids = append(ids, inv.InvitationProjectMember.ID)
		}
		assert.Contains(t, ids, created.ID)

		cancelled, err := client.CancelInvitation(t.Context(), api.CancelInvitationParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.CancelInvitationNoContent{}, cancelled, helpers.MustMarshal(t, cancelled))
		require.IsType(t, &api.GetInvitationNotFound{}, get(t, created.ID))

		again, err := client.CancelInvitation(t.Context(), api.CancelInvitationParams{ID: created.ID, ProjectID: projectID})
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

// TestInvitationAdminLimits covers what #2852's review checked by hand: the
// pending cap and replace at it, pagination, a concurrent replace and another
// project's ids.
func TestInvitationAdminLimits(t *testing.T) {
	t.Parallel()

	newProject := func(t *testing.T) (*domain.Project, *helpers.ApiClient) {
		t.Helper()
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		claimProject(t, project.ID)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, client, project)
		return project, client
	}
	create := func(t *testing.T, client *helpers.ApiClient, projectID api.ProjectID, replaces api.InvitationID) api.CreateInvitationRes {
		t.Helper()
		req := projectMemberInvitation(api.InvitationProjectMemberPayloadRelationViewer, "")
		if replaces != "" {
			req.ReplacesInvitationID = api.NewOptInvitationID(replaces)
		}
		resp, err := client.CreateInvitation(t.Context(), api.NewCreateInvitationProjectMemberRequestCreateInvitationRequest(req), api.CreateInvitationParams{ProjectID: projectID})
		require.NoError(t, err)
		return resp
	}
	createdID := func(t *testing.T, resp api.CreateInvitationRes) api.InvitationID {
		t.Helper()
		created, ok := resp.(*api.CreateInvitationResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		return created.CreateInvitationProjectMemberResponse.ID
	}

	t.Run("the pending cap, replace at it and pagination", func(t *testing.T) {
		t.Parallel()
		project, client := newProject(t)
		projectID := api.ProjectID(project.ID)

		// Seeded below the API, so the cap is reached without a hundred requests.
		stmts := harness.EnsureServiceDB(t).Statements()
		for range service.MaxPendingInvitations - 1 {
			_, tokenHash, err := domain.NewInvitationToken()
			require.NoError(t, err)
			journeyID, err := domain.NewInvitationJourneyID()
			require.NoError(t, err)
			require.NoError(t, stmts.CreateInvitation(t.Context(), &domain.Invitation{
				ProjectID:     project.ID,
				Type:          domain.InvitationTypeProjectMember,
				ProjectMember: &domain.InvitationProjectMember{Relation: "viewer"},
				ExpiresAt:     time.Now().Add(domain.InvitationExpiration),
				JourneyID:     journeyID,
				TokenHash:     tokenHash,
			}))
		}
		last := createdID(t, create(t, client, projectID, ""))

		limited, ok := create(t, client, projectID, "").(*api.CreateInvitationConflict)
		require.True(t, ok)
		assert.Equal(t, "inv.pending_limit", string(limited.Code))
		// A replace frees its original's place before the count.
		createdID(t, create(t, client, projectID, last))

		seen := map[api.InvitationID]bool{}
		params := api.ListInvitationsParams{ProjectID: projectID, Limit: api.NewOptLimit(30)}
		for pages := 0; ; pages++ {
			require.Less(t, pages, 10, "pagination does not end")
			resp, err := client.ListInvitations(t.Context(), params)
			require.NoError(t, err)
			page, ok := resp.(*api.ListInvitationsResponse)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			require.LessOrEqual(t, len(page.Invitations), 30)
			for _, inv := range page.Invitations {
				id := inv.InvitationProjectMember.ID
				require.False(t, seen[id], "%s listed twice", id)
				seen[id] = true
			}
			token, ok := page.NextPageToken.Get()
			if !ok {
				break
			}
			params.PageToken = api.NewOptPageToken(token)
		}
		assert.Len(t, seen, service.MaxPendingInvitations)
		assert.False(t, seen[last], "the replaced original is gone")
	})

	t.Run("of two concurrent replaces one wins", func(t *testing.T) {
		t.Parallel()
		project, client := newProject(t)
		projectID := api.ProjectID(project.ID)
		original := createdID(t, create(t, client, projectID, ""))

		results := make([]api.CreateInvitationRes, 2)
		var wg sync.WaitGroup
		for i := range results {
			wg.Go(func() {
				resp, err := client.CreateInvitation(t.Context(),
					api.NewCreateInvitationProjectMemberRequestCreateInvitationRequest(func() api.CreateInvitationProjectMemberRequest {
						req := projectMemberInvitation(api.InvitationProjectMemberPayloadRelationViewer, "")
						req.ReplacesInvitationID = api.NewOptInvitationID(original)
						return req
					}()),
					api.CreateInvitationParams{ProjectID: projectID})
				assert.NoError(t, err)
				results[i] = resp
			})
		}
		wg.Wait()

		var won, lost int
		for _, resp := range results {
			switch resp.(type) {
			case *api.CreateInvitationResponse:
				won++
			case *api.CreateInvitationNotFound:
				lost++
			default:
				t.Errorf("unexpected answer: %s", helpers.MustMarshal(t, resp))
			}
		}
		assert.Equal(t, 1, won)
		assert.Equal(t, 1, lost)

		listed, err := client.ListInvitations(t.Context(), api.ListInvitationsParams{ProjectID: projectID})
		require.NoError(t, err)
		page, ok := listed.(*api.ListInvitationsResponse)
		require.True(t, ok)
		assert.Len(t, page.Invitations, 1, "one invitation per journey")
	})

	t.Run("another project's invitation answers as unknown", func(t *testing.T) {
		t.Parallel()
		owner, ownerClient := newProject(t)
		other, otherClient := newProject(t)
		ownerID := api.ProjectID(owner.ID)
		foreign := createdID(t, create(t, otherClient, api.ProjectID(other.ID), ""))

		got, err := ownerClient.GetInvitation(t.Context(), api.GetInvitationParams{ID: foreign, ProjectID: ownerID})
		require.NoError(t, err)
		require.IsType(t, &api.GetInvitationNotFound{}, got, helpers.MustMarshal(t, got))

		cancelled, err := ownerClient.CancelInvitation(t.Context(), api.CancelInvitationParams{ID: foreign, ProjectID: ownerID})
		require.NoError(t, err)
		require.IsType(t, &api.CancelInvitationNotFound{}, cancelled, helpers.MustMarshal(t, cancelled))

		require.IsType(t, &api.CreateInvitationNotFound{}, create(t, ownerClient, ownerID, foreign))

		// The other project's invitation is untouched.
		still, err := otherClient.GetInvitation(t.Context(), api.GetInvitationParams{ID: foreign, ProjectID: api.ProjectID(other.ID)})
		require.NoError(t, err)
		inv, ok := still.(*api.Invitation)
		require.True(t, ok, helpers.MustMarshal(t, still))
		assert.Equal(t, api.InvitationStatusPending, inv.InvitationProjectMember.Status)
	})
}

// TestInvitationRedeem covers #2853: a platform user's session looks an
// invitation up by its link's token, accepts or declines it, and a token
// answers 404 once its invitation is finished.
func TestInvitationRedeem(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	projectID := api.ProjectID(project.ID)

	ownerID, owningTeamID := harness.CreateUserOwnedByTeam(t, platform.ID)
	cleanupPlatformUserAndTeam(t, ownerID)
	harness.SeedOwningTeam(t, project.ID, owningTeamID)

	sessionClient := func(t *testing.T, userID string) *helpers.ApiClient {
		t.Helper()
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		client.SetSessionToken(platformSessionCookie(t, userID).Value)
		return client
	}
	newColleague := func(t *testing.T) (string, *helpers.ApiClient) {
		t.Helper()
		userID, _ := harness.CreateUserOwnedByTeam(t, platform.ID)
		cleanupPlatformUserAndTeam(t, userID)
		return userID, sessionClient(t, userID)
	}
	owner := sessionClient(t, ownerID)

	// invite creates an invitation as the client and returns it with its token.
	invite := func(t *testing.T, client *helpers.ApiClient, relation api.InvitationProjectMemberPayloadRelation) (api.CreateInvitationProjectMemberResponse, string) {
		t.Helper()
		resp, err := client.CreateInvitation(t.Context(),
			api.NewCreateInvitationProjectMemberRequestCreateInvitationRequest(projectMemberInvitation(relation, "Jane Doe")),
			api.CreateInvitationParams{ProjectID: projectID})
		require.NoError(t, err)
		created, ok := resp.(*api.CreateInvitationResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		member, ok := created.GetCreateInvitationProjectMemberResponse()
		require.True(t, ok)
		link, err := url.Parse(member.Link)
		require.NoError(t, err)
		token, ok := strings.CutPrefix(link.Fragment, "token=")
		require.True(t, ok, link.Fragment)
		return member, token
	}
	accept := func(t *testing.T, client *helpers.ApiClient, token string) api.AcceptInvitationRes {
		t.Helper()
		resp, err := client.AcceptInvitation(t.Context(), &api.InvitationTokenRequest{Token: token})
		require.NoError(t, err)
		return resp
	}
	lookup := func(t *testing.T, client *helpers.ApiClient, token string) api.LookupInvitationRes {
		t.Helper()
		resp, err := client.LookupInvitation(t.Context(), &api.InvitationTokenRequest{Token: token})
		require.NoError(t, err)
		return resp
	}
	reject := func(t *testing.T, client *helpers.ApiClient, token string) api.RejectInvitationRes {
		t.Helper()
		resp, err := client.RejectInvitation(t.Context(), &api.InvitationTokenRequest{Token: token})
		require.NoError(t, err)
		return resp
	}

	// Grants are seeded and read below the API: an expired one can't be created
	// over it, and the colleague can't list the project's grants.
	stmts := harness.EnsureServiceDB(t).Statements()
	seedGrant := func(t *testing.T, userID, relation string, expiresAt *time.Time) string {
		t.Helper()
		asgn := &domain.AuthzAssignment{
			ProjectID:     project.ID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   userID,
			ObjectType:    "project",
			Relation:      relation,
			ExpiresAt:     expiresAt,
		}
		asgn.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), asgn))
		return asgn.ID
	}
	// grants returns the user's unrevoked direct grants on the project by relation.
	grants := func(t *testing.T, userID string) map[string][]*domain.AuthzAssignment {
		t.Helper()
		held, err := stmts.ListAuthzAssignments(t.Context(), project.ID, domain.AuthzPrincipalTypeUser, userID, false)
		require.NoError(t, err)
		byRelation := map[string][]*domain.AuthzAssignment{}
		for _, asgn := range held {
			if asgn.CatalogID == domain.SystemCatalogID && asgn.ObjectType == "project" && asgn.DelegationID == nil {
				byRelation[asgn.Relation] = append(byRelation[asgn.Relation], asgn)
			}
		}
		return byRelation
	}
	accepted := func(t *testing.T, resp api.AcceptInvitationRes) {
		t.Helper()
		got, ok := resp.(*api.Invitation)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		member, ok := got.GetInvitationProjectMember()
		require.True(t, ok)
		assert.Equal(t, api.InvitationStatusAccepted, member.Status)
	}

	t.Run("look up and accept", func(t *testing.T) {
		t.Parallel()
		created, token := invite(t, owner, api.InvitationProjectMemberPayloadRelationAdmin)
		colleagueID, colleague := newColleague(t)

		// Before accepting, the colleague cannot read the project.
		before, err := colleague.GetProject(t.Context(), api.GetProjectParams{ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.GetProjectNotFound{}, before, helpers.MustMarshal(t, before))

		found, ok := lookup(t, colleague, token).(*api.InvitationLookupResponse)
		require.True(t, ok)
		view, ok := found.GetInvitationLookupProjectMemberResponse()
		require.True(t, ok)
		assert.Equal(t, projectID, view.ProjectID)
		assert.Equal(t, project.Name, view.ProjectName)
		assert.Equal(t, api.InvitationProjectMemberPayloadRelationAdmin, view.ProjectMember.Relation)
		assert.Equal(t, ownerID, view.CreatedBy.Value)
		// The colleague cannot read platform users, so lookup names the inviter.
		inviter, ok := view.Inviter.Get()
		require.True(t, ok)
		assert.Equal(t, api.UserID(ownerID), inviter.UserID)
		assert.NotEmpty(t, inviter.Identifier.Value)
		assert.Equal(t, api.InvitationStatusPending, view.Status)
		assert.Equal(t, created.ExpiresAt.Unix(), view.ExpiresAt.Unix())

		got, ok := accept(t, colleague, token).(*api.Invitation)
		require.True(t, ok)
		member, ok := got.GetInvitationProjectMember()
		require.True(t, ok)
		assert.Equal(t, api.InvitationStatusAccepted, member.Status)
		assert.Equal(t, colleagueID, member.AcceptedBy.Value)
		assert.True(t, member.AcceptedAt.Set)
		assert.True(t, member.Metadata.IsNull())

		after, err := colleague.GetProject(t.Context(), api.GetProjectParams{ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.ProjectDetailResponse{}, after, helpers.MustMarshal(t, after))

		// A finished invitation's token answers like an unknown one.
		require.IsType(t, &api.LookupInvitationNotFound{}, lookup(t, colleague, token))
		require.IsType(t, &api.AcceptInvitationNotFound{}, accept(t, colleague, token))

		events := invitationEvents(t, owner, projectID, created.ID)
		require.ElementsMatch(t, []string{"invitation.created", "invitation.accepted"}, eventTypes(events))
		for _, event := range events {
			assert.NotContains(t, string(event.Payload), "Jane Doe")
			assert.NotContains(t, string(event.Payload), token)
		}
	})

	t.Run("decline", func(t *testing.T) {
		t.Parallel()
		created, token := invite(t, owner, api.InvitationProjectMemberPayloadRelationViewer)
		colleagueID, colleague := newColleague(t)

		resp, err := colleague.RejectInvitation(t.Context(), &api.InvitationTokenRequest{Token: token})
		require.NoError(t, err)
		got, ok := resp.(*api.Invitation)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		member, ok := got.GetInvitationProjectMember()
		require.True(t, ok)
		assert.Equal(t, api.InvitationStatusRejected, member.Status)
		assert.True(t, member.AcceptedBy.IsNull())
		assert.True(t, member.RejectedAt.Set)
		// A decline keeps who the link was for, for the administrators.
		assert.Equal(t, "Jane Doe", member.Metadata.Value.Name)

		require.IsType(t, &api.AcceptInvitationNotFound{}, accept(t, colleague, token))
		events := invitationEvents(t, owner, projectID, created.ID)
		require.ElementsMatch(t, []string{"invitation.created", "invitation.rejected"}, eventTypes(events))
		for _, event := range events {
			if event.EventType == "invitation.rejected" {
				assert.JSONEq(t, `{"journey_id":"`+created.JourneyID+`","user_id":"`+colleagueID+`"}`, string(event.Payload))
			}
		}

		// listed returns this invitation as the owner lists it, if it is on the page.
		listed := func(t *testing.T, params api.ListInvitationsParams) (api.InvitationProjectMember, bool) {
			t.Helper()
			params.ProjectID = projectID
			params.Limit = api.NewOptLimit(100)
			resp, err := owner.ListInvitations(t.Context(), params)
			require.NoError(t, err)
			page, ok := resp.(*api.ListInvitationsResponse)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			for _, inv := range page.Invitations {
				if item, ok := inv.GetInvitationProjectMember(); ok && item.ID == created.ID {
					return item, true
				}
			}
			return api.InvitationProjectMember{}, false
		}
		item, ok := listed(t, api.ListInvitationsParams{
			Status: []api.InvitationStatus{api.InvitationStatusPending, api.InvitationStatusRejected},
			Expand: []api.InvitationExpand{api.InvitationExpandInviter},
		})
		require.True(t, ok, "a rejected invitation matches pending or rejected")
		assert.Equal(t, "Jane Doe", item.Metadata.Value.Name)
		assert.Equal(t, member.RejectedAt.Value.Unix(), item.RejectedAt.Value.Unix())
		inviter, ok := item.Inviter.Get()
		require.True(t, ok, "expanded")
		assert.Equal(t, api.UserID(ownerID), inviter.UserID)
		assert.NotEmpty(t, inviter.Identifier.Value)

		item, ok = listed(t, api.ListInvitationsParams{Status: []api.InvitationStatus{api.InvitationStatusRejected}})
		require.True(t, ok)
		assert.False(t, item.Inviter.Set, "inviter is omitted unless expanded")
		_, ok = listed(t, api.ListInvitationsParams{Status: []api.InvitationStatus{api.InvitationStatusPending, api.InvitationStatusAccepted}})
		assert.False(t, ok, "a rejected invitation matches neither pending nor accepted")

		// The administrator removes the declined invitation, and its metadata with it.
		cancelled, err := owner.CancelInvitation(t.Context(), api.CancelInvitationParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.CancelInvitationNoContent{}, cancelled, helpers.MustMarshal(t, cancelled))
		gone, err := owner.GetInvitation(t.Context(), api.GetInvitationParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.GetInvitationNotFound{}, gone, helpers.MustMarshal(t, gone))
	})

	t.Run("refusals", func(t *testing.T) {
		t.Parallel()
		_, token := invite(t, owner, api.InvitationProjectMemberPayloadRelationEditor)

		self, ok := accept(t, owner, token).(*api.AcceptInvitationForbidden)
		require.True(t, ok)
		assert.Equal(t, "inv.self_accept", string(self.Code))
		declined, err := owner.RejectInvitation(t.Context(), &api.InvitationTokenRequest{Token: token})
		require.NoError(t, err)
		selfReject, ok := declined.(*api.RejectInvitationForbidden)
		require.True(t, ok, helpers.MustMarshal(t, declined))
		assert.Equal(t, "inv.self_reject", string(selfReject.Code))

		_, colleague := newColleague(t)
		colleague.SetOmitCSRF(true)
		csrf, ok := accept(t, colleague, token).(*api.AcceptInvitationForbidden)
		require.True(t, ok)
		assert.Equal(t, "auth.csrf_invalid", string(csrf.Code))
		// Lookup is a read: it needs no CSRF token.
		require.IsType(t, &api.InvitationLookupResponse{}, lookup(t, colleague, token))

		require.IsType(t, &api.LookupInvitationNotFound{}, lookup(t, colleague, "unknown"))

		// Only users homed in the platform project redeem.
		_, _, cookie := ownSessionUser(t)
		outsider, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		outsider.SetSessionToken(cookie.Value)
		require.IsType(t, &api.AcceptInvitationUnauthorized{}, accept(t, outsider, token))
	})

	t.Run("an inviter who lost admin", func(t *testing.T) {
		t.Parallel()
		adminID, admin := newColleague(t)
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, project)
		granted, err := secret.CreateGrant(t.Context(), &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationAdmin,
			User:     api.NewOptUserLocator(api.UserLocator{UserID: api.NewOptUserID(api.UserID(adminID))}),
		}, api.CreateGrantParams{ProjectID: projectID})
		require.NoError(t, err)
		grant, ok := granted.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, granted))

		_, token := invite(t, admin, api.InvitationProjectMemberPayloadRelationAdmin)
		_, err = secret.DeleteGrant(t.Context(), api.DeleteGrantParams{ID: grant.ID, ProjectID: projectID})
		require.NoError(t, err)

		_, colleague := newColleague(t)
		refused, ok := accept(t, colleague, token).(*api.AcceptInvitationForbidden)
		require.True(t, ok)
		assert.Equal(t, "inv.inviter_not_admin", string(refused.Code))
	})

	t.Run("accept renews an expired grant", func(t *testing.T) {
		t.Parallel()
		colleagueID, colleague := newColleague(t)
		expired := seedGrant(t, colleagueID, "admin", new(time.Now().Add(-time.Hour)))
		_, token := invite(t, owner, api.InvitationProjectMemberPayloadRelationAdmin)

		accepted(t, accept(t, colleague, token))

		admin := grants(t, colleagueID)["admin"]
		require.Len(t, admin, 1, "the expired grant is revoked")
		assert.NotEqual(t, expired, admin[0].ID)
		assert.Nil(t, admin[0].ExpiresAt)
		after, err := colleague.GetProject(t.Context(), api.GetProjectParams{ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.ProjectDetailResponse{}, after, helpers.MustMarshal(t, after))
	})

	t.Run("accept keeps an identical active grant", func(t *testing.T) {
		t.Parallel()
		colleagueID, colleague := newColleague(t)
		held := seedGrant(t, colleagueID, "editor", nil)
		_, token := invite(t, owner, api.InvitationProjectMemberPayloadRelationEditor)

		accepted(t, accept(t, colleague, token))

		editor := grants(t, colleagueID)["editor"]
		require.Len(t, editor, 1)
		assert.Equal(t, held, editor[0].ID)
	})

	t.Run("accept adds a relation beside another", func(t *testing.T) {
		t.Parallel()
		colleagueID, colleague := newColleague(t)
		viewer := seedGrant(t, colleagueID, "viewer", nil)
		_, token := invite(t, owner, api.InvitationProjectMemberPayloadRelationAdmin)

		accepted(t, accept(t, colleague, token))

		held := grants(t, colleagueID)
		require.Len(t, held["viewer"], 1)
		assert.Equal(t, viewer, held["viewer"][0].ID)
		require.Len(t, held["admin"], 1)
	})

	t.Run("of two concurrent accepts one wins", func(t *testing.T) {
		t.Parallel()
		_, token := invite(t, owner, api.InvitationProjectMemberPayloadRelationViewer)
		firstID, first := newColleague(t)
		secondID, second := newColleague(t)

		results := make([]api.AcceptInvitationRes, 2)
		var wg sync.WaitGroup
		for i, client := range []*helpers.ApiClient{first, second} {
			wg.Go(func() {
				resp, err := client.AcceptInvitation(t.Context(), &api.InvitationTokenRequest{Token: token})
				assert.NoError(t, err)
				results[i] = resp
			})
		}
		wg.Wait()

		var won, lost int
		for _, resp := range results {
			switch resp.(type) {
			case *api.Invitation:
				won++
			case *api.AcceptInvitationNotFound:
				lost++
			default:
				t.Errorf("unexpected answer: %s", helpers.MustMarshal(t, resp))
			}
		}
		assert.Equal(t, 1, won)
		assert.Equal(t, 1, lost)
		// Only the winner holds the relation.
		assert.Equal(t, 1, len(grants(t, firstID)["viewer"])+len(grants(t, secondID)["viewer"]))
	})

	t.Run("an expired invitation answers as unknown", func(t *testing.T) {
		t.Parallel()
		token, tokenHash, err := domain.NewInvitationToken()
		require.NoError(t, err)
		journeyID, err := domain.NewInvitationJourneyID()
		require.NoError(t, err)
		// Seeded below the API, which only creates invitations that expire later.
		require.NoError(t, stmts.CreateInvitation(t.Context(), &domain.Invitation{
			ProjectID:     project.ID,
			Type:          domain.InvitationTypeProjectMember,
			ProjectMember: &domain.InvitationProjectMember{Relation: "viewer"},
			CreatedBy:     &ownerID,
			ExpiresAt:     time.Now().Add(-time.Minute),
			JourneyID:     journeyID,
			TokenHash:     tokenHash,
		}))
		colleagueID, colleague := newColleague(t)

		require.IsType(t, &api.LookupInvitationNotFound{}, lookup(t, colleague, token))
		require.IsType(t, &api.AcceptInvitationNotFound{}, accept(t, colleague, token))
		require.IsType(t, &api.RejectInvitationNotFound{}, reject(t, colleague, token))
		assert.Empty(t, grants(t, colleagueID))
	})

	t.Run("a project secret's invitation", func(t *testing.T) {
		t.Parallel()
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, project)
		_, token := invite(t, secret, api.InvitationProjectMemberPayloadRelationViewer)
		colleagueID, colleague := newColleague(t)

		found, ok := lookup(t, colleague, token).(*api.InvitationLookupResponse)
		require.True(t, ok)
		view, ok := found.GetInvitationLookupProjectMemberResponse()
		require.True(t, ok)
		assert.True(t, view.CreatedBy.IsNull())
		assert.True(t, view.Inviter.IsNull())

		// No inviter to check, so only the project's claim applies.
		accepted(t, accept(t, colleague, token))
		require.Len(t, grants(t, colleagueID)["viewer"], 1)
	})
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
