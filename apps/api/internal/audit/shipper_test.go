package audit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

type fakeExportSource struct {
	mu sync.Mutex

	projects []string
	events   map[string][]*domain.Event // projectID -> ordered events
	cursors  map[string]*domain.EventSinkCursor
	failIDs  map[string]bool

	delivered []string
	upserts   []*domain.EventSinkCursor
}

func newFakeExportSource(projects []string, events map[string][]*domain.Event) *fakeExportSource {
	return &fakeExportSource{
		projects: projects,
		events:   events,
		cursors:  map[string]*domain.EventSinkCursor{},
		failIDs:  map[string]bool{},
	}
}

func cursorKey(sinkID, projectID string) string { return sinkID + "|" + projectID }

func (f *fakeExportSource) ListProjectIDs(context.Context) ([]string, error) {
	return append([]string(nil), f.projects...), nil
}

func (f *fakeExportSource) EnsureSink(context.Context, *domain.EventSink) error { return nil }

func (f *fakeExportSource) GetEventSinkCursor(_ context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.cursors[cursorKey(sinkID, projectID)]
	if !ok {
		return nil, nil
	}
	cp := *c
	return &cp, nil
}

func (f *fakeExportSource) UpsertEventSinkCursor(_ context.Context, cursor *domain.EventSinkCursor) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *cursor
	f.cursors[cursorKey(cursor.SinkID, cursor.ProjectID)] = &cp
	f.upserts = append(f.upserts, &cp)
	return nil
}

func (f *fakeExportSource) ListEventsAfterCursor(_ context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) ([]*domain.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	all := f.events[projectID]
	out := make([]*domain.Event, 0, limit)
	for _, ev := range all {
		if afterCreatedAt.IsZero() && afterID == "" {
			out = append(out, ev)
		} else if ev.CreatedAt.After(afterCreatedAt) || (ev.CreatedAt.Equal(afterCreatedAt) && ev.ID > afterID) {
			out = append(out, ev)
		}
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func TestShipper_AdvancesCursorOnSuccess(t *testing.T) {
	t.Parallel()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	src := newFakeExportSource([]string{"proj_a"}, map[string][]*domain.Event{
		"proj_a": {
			{ProjectID: "proj_a", ID: "evt_1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity},
			{ProjectID: "proj_a", ID: "evt_2", CreatedAt: t0.Add(time.Second), EventType: domain.EventTypeUserDeleted, Category: domain.EventCategoryEntity},
		},
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.client = srv.Client()
	sink := &domain.EventSink{
		ID:      "sink_deployment_webhook",
		Type:    domain.EventSinkTypeWebhook,
		Scope:   domain.EventSinkScopeDeployment,
		URL:     srv.URL,
		Enabled: true,
	}
	s.sinks = []*domain.EventSink{sink}

	s.shipOnce()

	got, err := src.GetEventSinkCursor(t.Context(), sink.ID, "proj_a")
	require.NoError(t, err)
	assert.Equal(t, "evt_2", got.LastEventID)
	require.Len(t, src.upserts, 1)
}

func TestShipper_HeadOfLineStopsOnFailure(t *testing.T) {
	t.Parallel()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	src := newFakeExportSource([]string{"proj_a"}, map[string][]*domain.Event{
		"proj_a": {
			{ProjectID: "proj_a", ID: "evt_ok", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity},
			{ProjectID: "proj_a", ID: "evt_fail", CreatedAt: t0.Add(time.Second), EventType: domain.EventTypeUserDeleted, Category: domain.EventCategoryEntity},
			{ProjectID: "proj_a", ID: "evt_skip", CreatedAt: t0.Add(2 * time.Second), EventType: domain.EventTypeUserDeleted, Category: domain.EventCategoryEntity},
		},
	})
	var hits []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		hits = append(hits, string(body))
		if len(hits) == 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.client = srv.Client()
	sink := &domain.EventSink{
		ID:      "sink_deployment_webhook",
		Type:    domain.EventSinkTypeWebhook,
		Scope:   domain.EventSinkScopeDeployment,
		URL:     srv.URL,
		Enabled: true,
	}
	s.sinks = []*domain.EventSink{sink}

	s.shipOnce()

	got, err := src.GetEventSinkCursor(t.Context(), sink.ID, "proj_a")
	require.NoError(t, err)
	assert.Equal(t, "evt_ok", got.LastEventID)
	assert.Len(t, hits, 2)
	require.Len(t, src.upserts, 1)
}

func TestShipper_IndependentProjectCursors(t *testing.T) {
	t.Parallel()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	src := newFakeExportSource([]string{"proj_a", "proj_b"}, map[string][]*domain.Event{
		"proj_a": {
			{ProjectID: "proj_a", ID: "evt_a1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity},
		},
		"proj_b": {
			{ProjectID: "proj_b", ID: "evt_b1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity},
		},
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.client = srv.Client()
	sink := &domain.EventSink{
		ID:      "sink_deployment_webhook",
		Type:    domain.EventSinkTypeWebhook,
		Scope:   domain.EventSinkScopeDeployment,
		URL:     srv.URL,
		Enabled: true,
	}
	s.sinks = []*domain.EventSink{sink}

	s.shipOnce()

	a, err := src.GetEventSinkCursor(t.Context(), sink.ID, "proj_a")
	require.NoError(t, err)
	b, err := src.GetEventSinkCursor(t.Context(), sink.ID, "proj_b")
	require.NoError(t, err)
	assert.Equal(t, "evt_a1", a.LastEventID)
	assert.Equal(t, "evt_b1", b.LastEventID)
}

func TestShipper_SkipsWhenNoClaimedProjects(t *testing.T) {
	t.Parallel()
	src := newFakeExportSource(nil, map[string][]*domain.Event{
		"proj_unclaimed": {
			{ProjectID: "proj_unclaimed", ID: "evt_1", CreatedAt: time.Now().UTC()},
		},
	})
	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.sinks = []*domain.EventSink{{
		ID:      "sink_deployment_stdout",
		Type:    domain.EventSinkTypeStdout,
		Enabled: true,
	}}
	s.shipOnce()
	assert.Empty(t, src.upserts)
}

func TestShipper_StartRejectsUnsupportedSinkType(t *testing.T) {
	t.Parallel()
	src := newFakeExportSource(nil, nil)
	s := NewShipper(src, ExportConfig{
		Enabled:  true,
		Interval: time.Hour,
		Sinks:    []SinkConfig{{Type: "webhkok", URL: "https://example.invalid/hook"}},
	})
	err := s.Start(t.Context())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported event sink type")
	assert.Empty(t, s.sinks)
}

func TestShipper_UnsupportedSinkTypeDoesNotAdvanceCursor(t *testing.T) {
	t.Parallel()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	src := newFakeExportSource([]string{"proj_a"}, map[string][]*domain.Event{
		"proj_a": {
			{ProjectID: "proj_a", ID: "evt_1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity},
		},
	})
	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.sinks = []*domain.EventSink{{
		ID:      "sink_bad",
		Type:    domain.EventSinkType("webhkok"),
		Enabled: true,
	}}
	s.shipOnce()
	assert.Empty(t, src.upserts)
}

func TestShipper_DrainsMultiplePagesInOneTick(t *testing.T) {
	t.Parallel()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	events := make([]*domain.Event, 0, 150)
	for i := 0; i < 150; i++ {
		events = append(events, &domain.Event{
			ProjectID: "proj_a",
			ID:        fmt.Sprintf("evt_%03d", i),
			CreatedAt: t0.Add(time.Duration(i) * time.Millisecond),
			EventType: domain.EventTypeUserCreated,
			Category:  domain.EventCategoryEntity,
		})
	}
	src := newFakeExportSource([]string{"proj_a"}, map[string][]*domain.Event{"proj_a": events})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.client = srv.Client()
	s.sinks = []*domain.EventSink{{
		ID:      "sink_deployment_webhook",
		Type:    domain.EventSinkTypeWebhook,
		Scope:   domain.EventSinkScopeDeployment,
		URL:     srv.URL,
		Enabled: true,
	}}

	s.shipOnce()

	got, err := src.GetEventSinkCursor(t.Context(), "sink_deployment_webhook", "proj_a")
	require.NoError(t, err)
	assert.Equal(t, "evt_149", got.LastEventID)
	require.Len(t, src.upserts, 2)
}

func TestShipper_PartialPageFailurePersistsLastSuccess(t *testing.T) {
	t.Parallel()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	src := newFakeExportSource([]string{"proj_a"}, map[string][]*domain.Event{
		"proj_a": {
			{ProjectID: "proj_a", ID: "evt_1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity},
			{ProjectID: "proj_a", ID: "evt_2", CreatedAt: t0.Add(time.Second), EventType: domain.EventTypeUserDeleted, Category: domain.EventCategoryEntity},
			{ProjectID: "proj_a", ID: "evt_fail", CreatedAt: t0.Add(2 * time.Second), EventType: domain.EventTypeUserDeleted, Category: domain.EventCategoryEntity},
			{ProjectID: "proj_a", ID: "evt_skip", CreatedAt: t0.Add(3 * time.Second), EventType: domain.EventTypeUserDeleted, Category: domain.EventCategoryEntity},
		},
	})
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		hits++
		if hits == 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.client = srv.Client()
	s.sinks = []*domain.EventSink{{
		ID:      "sink_deployment_webhook",
		Type:    domain.EventSinkTypeWebhook,
		Scope:   domain.EventSinkScopeDeployment,
		URL:     srv.URL,
		Enabled: true,
	}}

	s.shipOnce()

	got, err := src.GetEventSinkCursor(t.Context(), "sink_deployment_webhook", "proj_a")
	require.NoError(t, err)
	assert.Equal(t, "evt_2", got.LastEventID)
	assert.Equal(t, 3, hits)
	require.Len(t, src.upserts, 1)
}

func TestShipper_StartSkipsDisabledSinks(t *testing.T) {
	t.Parallel()
	src := newFakeExportSource(nil, nil)
	disabled := false
	s := NewShipper(src, ExportConfig{
		Enabled:  true,
		Interval: time.Hour,
		Sinks: []SinkConfig{{
			Type:    domain.EventSinkTypeStdout,
			Enabled: &disabled,
		}},
	})
	require.NoError(t, s.Start(t.Context()))
	t.Cleanup(s.Close)
	assert.Empty(t, s.sinks)
}

func TestExportConfig_Validate(t *testing.T) {
	assert.NoError(t, ExportConfig{}.Validate())
	assert.NoError(t, ExportConfig{Sinks: []SinkConfig{{Type: domain.EventSinkTypeStdout}, {Type: domain.EventSinkTypeWebhook, URL: "https://example.invalid/hook"}, {}}}.Validate())
	err := ExportConfig{Sinks: []SinkConfig{{Type: "webhkok", URL: "https://example.invalid/hook"}}}.Validate()
	assert.EqualError(t, err, `events.export.sinks: unsupported event sink type "webhkok"`)
}

// visitRecordingSource records the order the projects' cursors are read in,
// and can end a context at the first read.
type visitRecordingSource struct {
	*fakeExportSource
	visited []string
	atFirst func()
}

func (s *visitRecordingSource) GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error) {
	s.visited = append(s.visited, projectID)
	if len(s.visited) == 1 && s.atFirst != nil {
		s.atFirst()
	}
	return s.fakeExportSource.GetEventSinkCursor(ctx, sinkID, projectID)
}

func stdoutShipper(src EventExportSource) *Shipper {
	return NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour, Sinks: []SinkConfig{{Type: domain.EventSinkTypeStdout}}})
}

// A round that a wake-up runs has a deadline. It starts at a project picked
// per round, so the projects a short round leaves are not the same every
// time.
func TestShipper_OnceStartsAtThePickedProject(t *testing.T) {
	src := &visitRecordingSource{fakeExportSource: newFakeExportSource([]string{"proj_a", "proj_b", "proj_c"}, nil)}
	s := stdoutShipper(src)
	s.firstProject = func(n int) int {
		assert.Equal(t, 3, n)
		return 2
	}

	require.NoError(t, s.Once(t.Context()))
	assert.Equal(t, []string{"proj_c", "proj_a", "proj_b"}, src.visited)

	src.visited = nil
	s.shipOnce()
	assert.Equal(t, []string{"proj_a", "proj_b", "proj_c"}, src.visited, "the loop has no deadline and keeps the list's order")
}

// A round ends with its context and says so: what it left, the next ships.
func TestShipper_OnceEndsWithItsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	src := &visitRecordingSource{fakeExportSource: newFakeExportSource([]string{"proj_a", "proj_b", "proj_c"}, nil), atFirst: cancel}
	s := stdoutShipper(src)
	s.firstProject = func(int) int { return 0 }

	err := s.Once(ctx)

	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, []string{"proj_a"}, src.visited)
}

// The caller of a round hears that shipments failed, and how many; the loop
// only logs them.
func TestShipper_OnceReportsFailedShipments(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	event := func(project string) []*domain.Event {
		return []*domain.Event{{ProjectID: project, ID: "evt_1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity}}
	}
	src := newFakeExportSource([]string{"proj_a", "proj_b", "proj_c"}, map[string][]*domain.Event{"proj_a": event("proj_a"), "proj_c": event("proj_c")})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(srv.Close)
	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour, Sinks: []SinkConfig{{Type: domain.EventSinkTypeWebhook, URL: srv.URL}}})
	s.client = srv.Client()

	err := s.Once(t.Context())

	require.EqualError(t, err, "2 of 3 shipments failed, the first: Bad Gateway")
	assert.Empty(t, src.upserts)
}

// A round waits for the one this process is running, so the loop's round and
// a wake-up's never deliver the same events twice.
func TestShipper_RoundsOfOneProcessRunOneAfterTheOther(t *testing.T) {
	src := &visitRecordingSource{fakeExportSource: newFakeExportSource([]string{"proj_a"}, nil)}
	s := stdoutShipper(src)
	s.shipping <- struct{}{} // a round is running

	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	err := s.Once(ctx)

	assert.ErrorIs(t, err, context.DeadlineExceeded, "the second waited for the first until its own deadline")
	assert.Empty(t, src.visited, "and never read a cursor")
}
