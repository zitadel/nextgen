package service_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

func TestGrantService_Create_EventUsesAssignmentProject(t *testing.T) {
	t.Parallel()

	userID := "user_grant01"
	homeTeam := "team_home"
	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ProjectID: "proj_platform",
		TeamID:    &homeTeam,
	})
	var got *domain.Event
	svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
		expectActiveUserPrincipal(s, userID)
		s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, a *domain.AuthzAssignment) error {
				a.ID = "asgn_test01"
				a.CreatedAt = time.Now()
				a.UpdatedAt = a.CreatedAt
				return nil
			})
		s.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, ev *domain.Event) error {
				got = ev
				return nil
			})
	})
	_, err := svc.Create(ctx, service.CreateGrantInput{
		ProjectID:     "proj_customer",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   userID,
		Relation:      "viewer",
	})
	require.NoError(t, err)
	assertManagedGrantEvent(t, got, domain.EventTypeAuthzGranted, "asgn_test01")
}

func TestGrantService_Revoke_EventUsesAssignmentProject(t *testing.T) {
	t.Parallel()

	homeTeam := "team_home"
	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ProjectID: "proj_platform",
		TeamID:    &homeTeam,
	})
	var got *domain.Event
	svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
		s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_1").Return(
			testManagedGrant("asgn_1", "user_grant01"), nil)
		s.EXPECT().RevokeAuthzAssignment(gomock.Any(), "proj_customer", "asgn_1").Return(nil)
		s.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, e *domain.Event) error {
				got = e
				return nil
			})
	})
	require.NoError(t, svc.Revoke(ctx, "proj_customer", "asgn_1"))
	assertManagedGrantEvent(t, got, domain.EventTypeAuthzRevoked, "asgn_1")
}

func assertManagedGrantEvent(t *testing.T, got *domain.Event, typ domain.EventType, entityID string) {
	t.Helper()
	require.NotNil(t, got)
	assert.Equal(t, typ, got.EventType)
	assert.Equal(t, domain.EventCategoryAdmin, got.Category)
	assert.Equal(t, "proj_customer", got.ProjectID)
	assert.Nil(t, got.TeamID)
	require.NotNil(t, got.EntityType)
	assert.Equal(t, "authz_assignment", *got.EntityType)
	require.NotNil(t, got.EntityID)
	assert.Equal(t, entityID, *got.EntityID)

	switch typ {
	case domain.EventTypeAuthzGranted:
		var payload domain.AuthzGrantedPayload
		require.NoError(t, json.Unmarshal(got.Payload, &payload))
		assert.Equal(t, domain.AuthzGrantedPayload{
			PrincipalType: "user",
			PrincipalID:   "user_grant01",
			Relation:      "viewer",
		}, payload)
	case domain.EventTypeAuthzRevoked:
		var payload domain.AuthzRevokedPayload
		require.NoError(t, json.Unmarshal(got.Payload, &payload))
		assert.Equal(t, domain.AuthzRevokedPayload{
			PrincipalType: "user",
			PrincipalID:   "user_grant01",
			Relation:      "viewer",
		}, payload)
	default:
		t.Fatalf("unexpected event type %s", typ)
	}
}
