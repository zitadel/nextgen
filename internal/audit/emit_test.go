package audit_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
)

type insertEventCapture struct {
	called int
	last   *domain.Event
	err    error
}

func (c *insertEventCapture) InsertEvent(_ context.Context, event *domain.Event) error {
	c.called++
	c.last = event
	return c.err
}

func TestInsert_NoopsEmptyProjectID(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ev := audit.FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	require.NoError(t, audit.Insert(t.Context(), cap, ev))
	require.Equal(t, 0, cap.called)
}

func TestInsert_CallsInsertEvent(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ev := audit.FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	ev.ProjectID = "proj_1"
	require.NoError(t, audit.Insert(t.Context(), cap, ev))
	require.Equal(t, 1, cap.called)
	require.Equal(t, ev, cap.last)
}

func TestEmit_BuildsAndInserts(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	require.NoError(t, audit.Emit(t.Context(), cap, audit.EmitSpec{
		Type:       domain.EventTypeUserCreated,
		Category:   domain.EventCategoryEntity,
		ProjectID:  "proj_1",
		EntityType: "user",
		EntityID:   "user_1",
		Payload:    domain.UserCreatedPayload{},
	}))
	require.Equal(t, 1, cap.called)
	require.Equal(t, "proj_1", cap.last.ProjectID)
	require.Equal(t, domain.EventTypeUserCreated, cap.last.EventType)
	require.NotNil(t, cap.last.EntityID)
	require.Equal(t, "user_1", *cap.last.EntityID)
}

func TestEmit_CopiesRequestIDFromMiddleware(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ctx := middleware.WithRequestIDContext(t.Context(), "req_api")
	require.NoError(t, audit.Emit(ctx, cap, audit.EmitSpec{
		Type:       domain.EventTypeProjectCreated,
		Category:   domain.EventCategoryEntity,
		ProjectID:  "proj_1",
		EntityType: "project",
		EntityID:   "proj_1",
		Payload:    domain.ProjectPayload{Name: "Acme"},
	}))
	require.Equal(t, 1, cap.called)
	require.NotNil(t, cap.last.RequestID)
	require.Equal(t, "req_api", *cap.last.RequestID)
	require.Equal(t, json.RawMessage("{}"), cap.last.Metadata)
}

func TestEmit_ForceProjectIDOverridesActorHome(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	homeTeam := "team_home"
	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ProjectID: "proj_platform",
		TeamID:    &homeTeam,
	})
	require.NoError(t, audit.Emit(ctx, cap, audit.EmitSpec{
		Type:           domain.EventTypeAuthzGranted,
		Category:       domain.EventCategoryAdmin,
		ProjectID:      "proj_customer",
		EntityType:     "authz_assignment",
		EntityID:       "asgn_1",
		Payload:        domain.AuthzGrantedPayload{PrincipalType: "user", PrincipalID: "user_1", Relation: "viewer"},
		ForceProjectID: true,
		ClearTeamID:    true,
		Metadata: &domain.EventMetadata{
			Authorization: &domain.EventAuthorizationMetadata{
				ActorHomeProjectID: "proj_platform",
			},
		},
	}))
	require.Equal(t, 1, cap.called)
	require.Equal(t, "proj_customer", cap.last.ProjectID)
	require.Nil(t, cap.last.TeamID)
	var meta domain.EventMetadata
	require.NoError(t, json.Unmarshal(cap.last.Metadata, &meta))
	require.NotNil(t, meta.Authorization)
	require.Equal(t, "proj_platform", meta.Authorization.ActorHomeProjectID)
}
