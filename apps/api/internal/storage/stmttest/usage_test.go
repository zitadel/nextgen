//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ensureUsageProject creates a project whose usage rollups the test deletes
// again: no project delete cascades to them.
func ensureUsageProject(t *testing.T, d dialect) string {
	t.Helper()
	projectID := "proj-usage-" + uniqueSuffix(t)
	ensureEventProject(t, d.stmts, projectID)
	t.Cleanup(func() { _ = d.deleteProjectUsage(context.Background(), projectID) })
	return projectID
}

func sessionEstablished(projectID, userID string) *domain.Event {
	payload, _ := json.Marshal(map[string]string{"user_id": userID})
	return &domain.Event{
		ProjectID: projectID,
		EventType: domain.EventTypeSessionEstablished,
		Category:  domain.EventCategorySession,
		Payload:   payload,
		Metadata:  json.RawMessage(`{}`),
	}
}

// usageTime is a UTC instant with whole microseconds, which every dialect
// stores exactly.
func usageTime(day, hour int) time.Time {
	return time.Date(2026, time.October, day, hour, 0, 0, 0, time.UTC)
}

func TestUsageStatements_FirstSeen(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureUsageProject(t, d)
		meter := domain.MeterMonthlyActiveUsers
		october, november := usageTime(1, 0), time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC)

		seen, err := d.stmts.SeenUsageUsers(t.Context(), projectID, meter, october, []string{"u1", "u2"})
		require.NoError(t, err)
		assert.Empty(t, seen)

		require.NoError(t, d.stmts.InsertUsageFirstSeen(t.Context(), projectID, meter, october, []string{"u1", "u2"}))

		seen, err = d.stmts.SeenUsageUsers(t.Context(), projectID, meter, october, []string{"u1", "u2", "u3"})
		require.NoError(t, err)
		assert.ElementsMatch(t, []string{"u1", "u2"}, seen)

		seen, err = d.stmts.SeenUsageUsers(t.Context(), projectID, meter, november, []string{"u1"})
		require.NoError(t, err)
		assert.Empty(t, seen, "each month counts its users again")
	})
}

func TestUsageStatements_AddAndReadHours(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureUsageProject(t, d)
		other := ensureUsageProject(t, d)
		meter := domain.MeterMonthlyActiveUsers
		h1, h2, h3 := usageTime(5, 9), usageTime(5, 10), usageTime(6, 0)

		require.NoError(t, d.stmts.AddUsageHours(t.Context(), projectID, []domain.UsageHour{{Meter: meter, Hour: h1, Value: 3}}))
		require.NoError(t, d.stmts.AddUsageHours(t.Context(), projectID, []domain.UsageHour{
			{Meter: meter, Hour: h1, Value: 2},
			{Meter: meter, Hour: h2, Value: 1},
			{Meter: "another_meter", Hour: h2, Value: 7},
		}))
		require.NoError(t, d.stmts.AddUsageHours(t.Context(), other, []domain.UsageHour{{Meter: meter, Hour: h1, Value: 9}}))

		hours, err := d.stmts.ReadUsageHours(t.Context(), projectID, []string{meter}, h1, h3)
		require.NoError(t, err)
		assert.Equal(t, []domain.UsageHour{
			{Meter: meter, Hour: h1, Value: 5},
			{Meter: meter, Hour: h2, Value: 1},
		}, hours, "an hour adds up, other meters and projects stay out")

		hours, err = d.stmts.ReadUsageHours(t.Context(), projectID, []string{meter}, h1, h2)
		require.NoError(t, err)
		assert.Equal(t, []domain.UsageHour{{Meter: meter, Hour: h1, Value: 5}}, hours, "to is exclusive")
	})
}

func TestUsageStatements_AdvanceCursor(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureUsageProject(t, d)
		first := domain.UsageCursor{ProjectID: projectID, CountedBefore: usageTime(5, 9), LastEventID: "evt-a"}
		second := domain.UsageCursor{ProjectID: projectID, CountedBefore: usageTime(5, 10)}

		cursor, err := d.stmts.GetUsageCursor(t.Context(), projectID)
		require.NoError(t, err)
		assert.Nil(t, cursor)

		moved, err := d.stmts.AdvanceUsageCursor(t.Context(), nil, first)
		require.NoError(t, err)
		assert.True(t, moved)
		moved, err = d.stmts.AdvanceUsageCursor(t.Context(), nil, second)
		require.NoError(t, err)
		assert.False(t, moved, "a second first cursor finds one stored")

		stored, err := d.stmts.GetUsageCursor(t.Context(), projectID)
		require.NoError(t, err)
		require.NotNil(t, stored)
		assert.Equal(t, first, *stored)

		moved, err = d.stmts.AdvanceUsageCursor(t.Context(), stored, second)
		require.NoError(t, err)
		assert.True(t, moved)
		moved, err = d.stmts.AdvanceUsageCursor(t.Context(), stored, first)
		require.NoError(t, err)
		assert.False(t, moved, "a stale cursor moves nothing")

		stored, err = d.stmts.GetUsageCursor(t.Context(), projectID)
		require.NoError(t, err)
		require.NotNil(t, stored)
		assert.Equal(t, second, *stored)
	})
}

// Two runs that read the same cursor: exactly one moves it.
func TestUsageStatements_AdvanceCursor_ConcurrentRuns(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		if d.name == "sqlite" {
			t.Skip("sqlite serializes writers; interleaving not constructible")
		}
		projectID := ensureUsageProject(t, d)
		prev := domain.UsageCursor{ProjectID: projectID, CountedBefore: usageTime(5, 9)}
		_, err := d.stmts.AdvanceUsageCursor(t.Context(), nil, prev)
		require.NoError(t, err)

		advance := func(next domain.UsageCursor, held func()) (bool, error) {
			var moved bool
			err := d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				var err error
				moved, err = tx.Statements().AdvanceUsageCursor(ctx, &prev, next)
				if err == nil && held != nil {
					held()
				}
				return err
			})
			return moved, err
		}

		var once sync.Once
		updated := make(chan struct{})
		commit := make(chan struct{})
		release := sync.OnceFunc(func() { close(commit) })
		t.Cleanup(release)
		type result struct {
			moved bool
			err   error
		}
		firstDone := make(chan result, 1)
		go func() {
			moved, err := advance(domain.UsageCursor{ProjectID: projectID, CountedBefore: usageTime(5, 10)}, func() {
				// Once per attempt: spanner replays aborted attempts.
				once.Do(func() { close(updated) })
				<-commit
			})
			firstDone <- result{moved, err}
		}()
		select {
		case <-updated:
		case r := <-firstDone:
			t.Fatalf("the first run ended before it moved the cursor: %v", r.err)
		}
		secondDone := make(chan result, 1)
		go func() {
			moved, err := advance(domain.UsageCursor{ProjectID: projectID, CountedBefore: usageTime(5, 11)}, nil)
			secondDone <- result{moved, err}
		}()
		release()

		first, second := <-firstDone, <-secondDone
		require.NoError(t, first.err)
		require.NoError(t, second.err)
		assert.NotEqual(t, first.moved, second.moved, "exactly one run moves the cursor")
	})
}

func TestUsageStatements_CursorGoesWithItsProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := "proj-usage-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		t.Cleanup(func() { _ = d.deleteProjectUsage(context.Background(), projectID) })
		meter := domain.MeterMonthlyActiveUsers
		_, err := d.stmts.AdvanceUsageCursor(t.Context(), nil, domain.UsageCursor{ProjectID: projectID, CountedBefore: usageTime(5, 9)})
		require.NoError(t, err)
		require.NoError(t, d.stmts.AddUsageHours(t.Context(), projectID, []domain.UsageHour{{Meter: meter, Hour: usageTime(5, 8), Value: 4}}))

		changed, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)
		require.True(t, changed)

		cursor, err := d.stmts.GetUsageCursor(t.Context(), projectID)
		require.NoError(t, err)
		assert.Nil(t, cursor, "the cursor cascades from the project")
		hours, err := d.stmts.ReadUsageHours(t.Context(), projectID, []string{meter}, usageTime(5, 0), usageTime(6, 0))
		require.NoError(t, err)
		assert.Len(t, hours, 1, "the project's usage outlives it")
	})
}

func TestUsageStatements_ReadUsageEvents(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureUsageProject(t, d)
		types := []domain.EventType{domain.EventTypeSessionEstablished}
		first, second := sessionEstablished(projectID, "u1"), sessionEstablished(projectID, "u2")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), first))
		require.NoError(t, d.stmts.InsertEvent(t.Context(), sampleEvent(projectID, "")))
		require.NoError(t, d.stmts.InsertEvent(t.Context(), second))

		events, bound, err := d.stmts.ReadUsageEvents(t.Context(), projectID, nil, types, 10)
		require.NoError(t, err)
		assert.Equal(t, []string{first.ID, second.ID}, eventIDs(events), "only the meter's types, oldest first")
		for _, ev := range events {
			assert.True(t, ev.CreatedAt.Before(bound), "the bound follows every event it covers")
		}

		events, _, err = d.stmts.ReadUsageEvents(t.Context(), projectID, nil, types, 1)
		require.NoError(t, err)
		assert.Equal(t, []string{first.ID}, eventIDs(events))

		atFirst := domain.UsageCursor{ProjectID: projectID, CountedBefore: first.CreatedAt, LastEventID: first.ID}
		events, _, err = d.stmts.ReadUsageEvents(t.Context(), projectID, &atFirst, types, 10)
		require.NoError(t, err)
		assert.Equal(t, []string{second.ID}, eventIDs(events), "after an event's cursor")

		// A cursor on the bound: an event that commits later is read next.
		atBound := domain.UsageCursor{ProjectID: projectID, CountedBefore: bound}
		moved, err := d.stmts.AdvanceUsageCursor(t.Context(), nil, atBound)
		require.NoError(t, err)
		require.True(t, moved)
		events, _, err = d.stmts.ReadUsageEvents(t.Context(), projectID, &atBound, types, 10)
		require.NoError(t, err)
		assert.Empty(t, events)

		third := sessionEstablished(projectID, "u3")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), third))
		events, _, err = d.stmts.ReadUsageEvents(t.Context(), projectID, &atBound, types, 10)
		require.NoError(t, err)
		assert.Equal(t, []string{third.ID}, eventIDs(events), "after a bound's cursor")
	})
}

func TestUsageStatements_DeleteCountedEventsOlderThan(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		counted := ensureUsageProject(t, d)
		uncursored := ensureUsageProject(t, d)
		early, late := sessionEstablished(counted, "u1"), sessionEstablished(counted, "u2")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), early))
		require.NoError(t, d.stmts.InsertEvent(t.Context(), late))
		other := sessionEstablished(uncursored, "u3")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), other))
		_, err := d.stmts.AdvanceUsageCursor(t.Context(), nil, domain.UsageCursor{ProjectID: counted, CountedBefore: late.CreatedAt})
		require.NoError(t, err)

		_, err = d.stmts.DeleteCountedEventsOlderThan(t.Context(), time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)

		_, err = d.stmts.GetEventByID(t.Context(), counted, early.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a counted event purges by age")
		_, err = d.stmts.GetEventByID(t.Context(), counted, late.ID)
		assert.NoError(t, err, "an event the projector has not counted stays")
		_, err = d.stmts.GetEventByID(t.Context(), uncursored, other.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a project with no cursor purges by age")
	})
}

func eventIDs(events []*domain.Event) []string {
	ids := make([]string, 0, len(events))
	for _, ev := range events {
		ids = append(ids, ev.ID)
	}
	return ids
}
