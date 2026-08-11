//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

func uniqueEventIDs(t *testing.T) (projectID, eventID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-evt-" + suffix, "evt-" + suffix
}

func ensureEventProject(t *testing.T, stmts service.AllStatements, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })
}

func sampleEvent(projectID, id string) *domain.Event {
	actor := "user_sample"
	actorType := domain.EventActorTypeHuman
	entityType := "user"
	entityID := "user_sample"
	payload, _ := json.Marshal(domain.UserCreatedPayload{UserID: entityID, SchemaID: "sch_default"})
	return &domain.Event{
		ProjectID:  projectID,
		ID:         id,
		EventType:  domain.EventTypeUserCreated,
		Category:   domain.EventCategoryEntity,
		ActorID:    &actor,
		ActorType:  &actorType,
		EntityType: &entityType,
		EntityID:   &entityID,
		ClientID:   "app_test",
		Payload:    payload,
		Metadata:   json.RawMessage(`{}`),
	}
}

func TestEventStatements_InsertAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, eventID := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, eventID)
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))
		assert.False(t, entity.CreatedAt.IsZero())
		assert.False(t, entity.OccurredAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
		assert.WithinDuration(t, entity.CreatedAt, entity.OccurredAt, time.Second)

		got, err := d.stmts.GetEventByID(t.Context(), projectID, eventID)
		require.NoError(t, err)
		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, entity.EventType, got.EventType)
		assert.Equal(t, entity.Category, got.Category)
		assert.Equal(t, entity.ClientID, got.ClientID)
		require.NotNil(t, got.ActorID)
		assert.Equal(t, *entity.ActorID, *got.ActorID)
		assert.JSONEq(t, string(entity.Payload), string(got.Payload))
	})
}

func TestEventStatements_Insert_EmptyIDAssigned(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, "")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))
		require.NotEmpty(t, entity.ID)
		assert.True(t, strings.HasPrefix(entity.ID, string(domain.PrefixEvent)+"_"))

		got, err := d.stmts.GetEventByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, got.ID)
	})
}

func TestEventStatements_Insert_OccurredAtWait(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, "")
		entity.OccurredAtWait = 250 * time.Millisecond
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))
		assert.True(t, entity.CreatedAt.After(entity.OccurredAt) || entity.CreatedAt.Equal(entity.OccurredAt.Add(200*time.Millisecond)))
		delta := entity.CreatedAt.Sub(entity.OccurredAt)
		assert.GreaterOrEqual(t, delta, 200*time.Millisecond)
		assert.LessOrEqual(t, delta, time.Second)
	})
}

func TestEventStatements_ListKeyset(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		first := sampleEvent(projectID, "evt-001")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), first))
		second := sampleEvent(projectID, "evt-002")
		second.EventType = domain.EventTypeUserUpdated
		require.NoError(t, d.stmts.InsertEvent(t.Context(), second))

		page1, err := d.stmts.ListEvents(t.Context(), events.ListOptions(projectID, 1))
		require.NoError(t, err)
		require.Len(t, page1.Items, 1)
		assert.Equal(t, "evt-001", page1.Items[0].ID)
		require.NotEmpty(t, page1.NextCursor)

		opts := events.ListOptions(projectID, 1)
		opts.Pagination.Cursor = page1.NextCursor
		page2, err := d.stmts.ListEvents(t.Context(), opts)
		require.NoError(t, err)
		require.Len(t, page2.Items, 1)
		assert.Equal(t, "evt-002", page2.Items[0].ID)
	})
}

func TestEventStatements_Get_NotFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		_, err := d.stmts.GetEventByID(t.Context(), projectID, "evt_missing")
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestEventStatements_DeleteOlderThan(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, "")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))

		n, err := d.stmts.DeleteEventsOlderThan(t.Context(), projectID, time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)
		assert.Equal(t, int64(1), n)

		_, err = d.stmts.GetEventByID(t.Context(), projectID, entity.ID)
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestEventStatements_SinkCursor(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		sink := &domain.EventSink{
			ID:      "sink_test_" + uniqueSuffix(t),
			Type:    domain.EventSinkTypeStdout,
			Scope:   domain.EventSinkScopeDeployment,
			Enabled: true,
		}
		require.NoError(t, d.stmts.EnsureEventSink(t.Context(), sink))

		_, err := d.stmts.GetEventSinkCursor(t.Context(), sink.ID, projectID)
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		first := sampleEvent(projectID, "evt-cursor-001")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), first))
		second := sampleEvent(projectID, "evt-cursor-002")
		second.EventType = domain.EventTypeUserUpdated
		require.NoError(t, d.stmts.InsertEvent(t.Context(), second))

		all, err := d.stmts.ListEventsAfterCursor(t.Context(), projectID, time.Time{}, "", 10)
		require.NoError(t, err)
		require.Len(t, all, 2)
		assert.Equal(t, "evt-cursor-001", all[0].ID)
		assert.Equal(t, "evt-cursor-002", all[1].ID)

		require.NoError(t, d.stmts.UpsertEventSinkCursor(t.Context(), &domain.EventSinkCursor{
			SinkID:        sink.ID,
			ProjectID:     projectID,
			LastCreatedAt: first.CreatedAt,
			LastEventID:   first.ID,
		}))
		got, err := d.stmts.GetEventSinkCursor(t.Context(), sink.ID, projectID)
		require.NoError(t, err)
		assert.Equal(t, first.ID, got.LastEventID)

		rest, err := d.stmts.ListEventsAfterCursor(t.Context(), projectID, first.CreatedAt, first.ID, 10)
		require.NoError(t, err)
		require.Len(t, rest, 1)
		assert.Equal(t, "evt-cursor-002", rest[0].ID)

		require.NoError(t, d.stmts.UpsertEventSinkCursor(t.Context(), &domain.EventSinkCursor{
			SinkID:        sink.ID,
			ProjectID:     projectID,
			LastCreatedAt: second.CreatedAt,
			LastEventID:   second.ID,
		}))
		got, err = d.stmts.GetEventSinkCursor(t.Context(), sink.ID, projectID)
		require.NoError(t, err)
		assert.Equal(t, second.ID, got.LastEventID)
	})
}
