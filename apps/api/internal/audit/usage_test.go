package audit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// fakeUsageStore holds one project's events and cursor in memory, and counts
// as service.UsageStore does: the cursor must still be prev.
type fakeUsageStore struct {
	mu      sync.Mutex
	events  []*domain.Event
	cursor  *domain.UsageCursor
	bound   time.Time
	counted []domain.UsageTouch
	// race moves the cursor elsewhere before the next count, as a second
	// run would.
	race bool
}

func (f *fakeUsageStore) ListProjectIDs(context.Context) ([]string, error) {
	return []string{"proj_1"}, nil
}

func (f *fakeUsageStore) GetUsageCursor(context.Context, string) (*domain.UsageCursor, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cursor == nil {
		return nil, nil
	}
	c := *f.cursor
	return &c, nil
}

func (f *fakeUsageStore) ReadUsageEvents(_ context.Context, _ string, after *domain.UsageCursor, _ []domain.EventType, limit uint32) ([]*domain.Event, time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*domain.Event
	for _, ev := range f.events {
		if after != nil && !ev.CreatedAt.After(after.CountedBefore) &&
			!(ev.CreatedAt.Equal(after.CountedBefore) && ev.ID > after.LastEventID) {
			continue
		}
		if len(out) == int(limit) {
			break
		}
		out = append(out, ev)
	}
	return out, f.bound, nil
}

func (f *fakeUsageStore) CountUsage(_ context.Context, prev *domain.UsageCursor, next domain.UsageCursor, touches []domain.UsageTouch) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.race {
		f.cursor = &domain.UsageCursor{ProjectID: next.ProjectID, CountedBefore: next.CountedBefore.Add(time.Hour)}
	}
	if (prev == nil) != (f.cursor == nil) || (prev != nil && *prev != *f.cursor) {
		return false, nil
	}
	f.cursor = &next
	f.counted = append(f.counted, touches...)
	return true, nil
}

func signIn(id, user string, at time.Time) *domain.Event {
	payload, _ := json.Marshal(map[string]string{"user_id": user})
	return &domain.Event{ID: id, EventType: domain.EventTypeSessionEstablished, CreatedAt: at, Payload: payload}
}

func TestUsageTouches_CountEachUserOncePerMonthAtTheirFirstHour(t *testing.T) {
	oct := func(day, hour, minute int) time.Time {
		return time.Date(2026, time.October, day, hour, minute, 0, 0, time.UTC)
	}
	nov := time.Date(2026, time.November, 1, 0, 5, 0, 0, time.UTC)
	other := &domain.Event{ID: "evt-x", EventType: domain.EventTypeUserCreated, CreatedAt: oct(31, 9, 0), Payload: json.RawMessage(`{"user_id":"u9"}`)}
	anonymous := &domain.Event{ID: "evt-y", EventType: domain.EventTypeSessionEstablished, CreatedAt: oct(31, 9, 1), Payload: json.RawMessage(`{}`)}

	touches := usageTouches([]*domain.Event{
		signIn("evt-1", "u1", oct(31, 9, 10)),
		signIn("evt-2", "u1", oct(31, 9, 20)),
		other,
		anonymous,
		signIn("evt-3", "u2", oct(31, 10, 0)),
		signIn("evt-4", "u1", nov),
	})

	month := domain.UsageMonth(oct(1, 0, 0))
	assert.Equal(t, []domain.UsageTouch{
		{Meter: domain.MeterMonthlyActiveUsers, Month: month, UserID: "u1", Hour: oct(31, 9, 0)},
		{Meter: domain.MeterMonthlyActiveUsers, Month: month, UserID: "u2", Hour: oct(31, 10, 0)},
		{Meter: domain.MeterMonthlyActiveUsers, Month: domain.UsageMonth(nov), UserID: "u1", Hour: nov.Truncate(time.Hour)},
	}, touches, "another type, or a session without a user, counts nothing")
}

func TestNextUsageCursor(t *testing.T) {
	at := time.Date(2026, time.October, 31, 9, 30, 0, 0, time.UTC)
	full := make([]*domain.Event, usageBatchLimit)
	for i := range full {
		full[i] = signIn("evt-"+strconv.Itoa(i), "u", at)
	}
	last := full[len(full)-1]
	prev := &domain.UsageCursor{ProjectID: "proj_1", CountedBefore: at}

	tests := map[string]struct {
		prev  *domain.UsageCursor
		batch []*domain.Event
		bound time.Time
		want  *domain.UsageCursor
	}{
		"a full batch stops on its last event": {
			prev: prev, batch: full, bound: at.Add(time.Minute),
			want: &domain.UsageCursor{ProjectID: "proj_1", CountedBefore: last.CreatedAt, LastEventID: last.ID},
		},
		"a short batch moves to the bound": {
			prev: prev, batch: full[:3], bound: at.Add(time.Minute),
			want: &domain.UsageCursor{ProjectID: "proj_1", CountedBefore: at.Add(time.Minute)},
		},
		"a first run starts the cursor": {
			bound: at,
			want:  &domain.UsageCursor{ProjectID: "proj_1", CountedBefore: at},
		},
		"it never moves back": {
			prev: prev, batch: full[:1], bound: at.Add(-time.Second),
		},
		"an idle project waits for the next hour": {
			prev: prev, bound: at.Add(10 * time.Minute),
		},
		"an idle project moves into the next hour": {
			prev: prev, bound: at.Add(31 * time.Minute),
			want: &domain.UsageCursor{ProjectID: "proj_1", CountedBefore: at.Add(31 * time.Minute)},
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			next, ok := nextUsageCursor("proj_1", tc.prev, tc.batch, tc.bound)
			if tc.want == nil {
				assert.False(t, ok)
				return
			}
			require.True(t, ok)
			assert.Equal(t, *tc.want, next)
		})
	}
}

func TestUsageProjector_CountsEveryBatchOnce(t *testing.T) {
	start := time.Date(2026, time.October, 31, 9, 0, 0, 0, time.UTC)
	store := &fakeUsageStore{bound: start.Add(time.Hour)}
	for i := range usageBatchLimit + 2 {
		store.events = append(store.events, signIn("evt-"+strconv.Itoa(1000+i), "u"+strconv.Itoa(i%3), start.Add(time.Duration(i)*time.Second)))
	}
	p := NewUsageProjector(store, UsageConfig{Enabled: true, Interval: time.Hour})

	run, err := p.Count(t.Context())
	require.NoError(t, err)
	assert.Equal(t, UsageRun{Projects: 1, Events: usageBatchLimit + 2}, run)
	assert.Len(t, store.counted, 3+2, "each batch names its users once; service.UsageStore drops those the month counted")
	assert.Equal(t, start.Add(time.Hour), store.cursor.CountedBefore, "the short last batch ends on the bound")

	run, err = p.Count(t.Context())
	require.NoError(t, err)
	assert.Zero(t, run.Events, "a second run finds nothing new")
}

func TestUsageProjector_StopsWhenAnotherRunMovedTheCursor(t *testing.T) {
	start := time.Date(2026, time.October, 31, 9, 0, 0, 0, time.UTC)
	store := &fakeUsageStore{bound: start.Add(time.Hour), race: true}
	store.events = []*domain.Event{signIn("evt-1", "u1", start)}
	p := NewUsageProjector(store, UsageConfig{Enabled: true, Interval: time.Hour})

	run, err := p.Count(t.Context())
	require.NoError(t, err)
	assert.Zero(t, run.Events)
	assert.Empty(t, store.counted)
}

func TestUsageConfig_Validate(t *testing.T) {
	assert.NoError(t, UsageConfig{}.Validate())
	assert.NoError(t, UsageConfig{TriggerSecret: testTriggerSecret}.Validate())
	assert.ErrorContains(t, UsageConfig{TriggerSecret: "short"}.Validate(), "usage.trigger_secret must be at least 16")
}

func TestUsageProjector_TriggerOnlyWithASecretAndCountingOn(t *testing.T) {
	store := &fakeUsageStore{}
	assert.Nil(t, NewUsageProjector(store, UsageConfig{Enabled: true}).Trigger())
	assert.Nil(t, NewUsageProjector(store, UsageConfig{TriggerSecret: testTriggerSecret}).Trigger())
	assert.NotNil(t, NewUsageProjector(store, UsageConfig{Enabled: true, TriggerSecret: testTriggerSecret}).Trigger())
}

func TestUsageProjector_TriggerCountsOncePerRequest(t *testing.T) {
	start := time.Date(2026, time.October, 31, 9, 0, 0, 0, time.UTC)
	store := &fakeUsageStore{bound: start.Add(time.Hour), events: []*domain.Event{signIn("evt-1", "u1", start)}}
	trigger := NewUsageProjector(store, UsageConfig{Enabled: true, TriggerSecret: testTriggerSecret}).Trigger()

	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, UsageTriggerPath, nil)
	trigger.ServeHTTP(rec, r)
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "no bearer token")

	rec = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPut, UsageTriggerPath, nil)
	r.Header.Set("Authorization", "Bearer "+testTriggerSecret)
	trigger.ServeHTTP(rec, r)
	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)

	rec = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, UsageTriggerPath, nil)
	r.Header.Set("Authorization", "Bearer "+testTriggerSecret)
	trigger.ServeHTTP(rec, r)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"projects":1,"events":1}`, rec.Body.String())
	assert.Len(t, store.counted, 1)
}
