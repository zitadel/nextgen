package audit_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

type stubInserter struct{ err error }

func (s stubInserter) InsertEvent(context.Context, *domain.Event) error { return s.err }

func (s stubInserter) InsertEvents(context.Context, []*domain.Event) error { return s.err }

// read returns, per instrument, `attribute value -> count` of its single
// attribute.
func read(t *testing.T, reader metric.Reader) map[string]map[string]uint64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))
	out := map[string]map[string]uint64{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			out[m.Name] = map[string]uint64{}
			put := func(set attribute.Set, n uint64) {
				for _, kv := range set.ToSlice() {
					out[m.Name][kv.Value.AsString()] += n
				}
			}
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, p := range data.DataPoints {
					put(p.Attributes, uint64(p.Value))
				}
			case metricdata.Histogram[float64]:
				for _, p := range data.DataPoints {
					put(p.Attributes, p.Count)
				}
			}
		}
	}
	return out
}

// Not run in parallel: it replaces the process-wide default Application.
func TestAuditMetrics(t *testing.T) {
	setup := func(t *testing.T) metric.Reader {
		reader := metric.NewManualReader()
		app, err := metrics.NewApplication(metrics.WithMeterProvider(metric.NewMeterProvider(metric.WithReader(reader))))
		require.NoError(t, err)
		metrics.SetDefault(app)
		t.Cleanup(func() { metrics.SetDefault(nil) })
		return reader
	}
	events := []*domain.Event{
		{ProjectID: "proj-1", EventType: domain.EventTypeAuthTokenRevoked},
		{ProjectID: "proj-2", EventType: domain.EventTypeAuthTokenRevoked},
		{ProjectID: "proj-3", EventType: "request.api"},
	}

	t.Run("an event written in its transaction", func(t *testing.T) {
		reader := setup(t)
		require.NoError(t, audit.Insert(t.Context(), stubInserter{}, events[0]))

		got := read(t, reader)
		assert.Equal(t, map[string]uint64{"event": 1}, got[metrics.AuditInsertDuration])
		assert.Equal(t, map[string]uint64{"auth.token.revoked": 1}, got[metrics.AuditEventsWritten], "typed, and never by project")
	})

	t.Run("an event that was skipped is not an insert", func(t *testing.T) {
		reader := setup(t)
		require.NoError(t, audit.Insert(t.Context(), stubInserter{}, &domain.Event{EventType: domain.EventTypeAuthTokenRevoked}))
		assert.Empty(t, read(t, reader))
	})

	t.Run("an insert that failed is timed but its event is not counted", func(t *testing.T) {
		reader := setup(t)
		require.Error(t, audit.Insert(t.Context(), stubInserter{err: errors.New("boom")}, events[0]))

		got := read(t, reader)
		assert.Equal(t, map[string]uint64{"event": 1}, got[metrics.AuditInsertDuration])
		assert.NotContains(t, got, metrics.AuditEventsWritten)
	})

	t.Run("a flush of the request buffer", func(t *testing.T) {
		reader := setup(t)
		require.NoError(t, audit.NewMeteredBatchInserter(stubInserter{}).InsertEvents(t.Context(), events))

		got := read(t, reader)
		assert.Equal(t, map[string]uint64{"request": 1}, got[metrics.AuditInsertDuration], "one flush is one insert, whatever its size")
		assert.Equal(t, map[string]uint64{"auth.token.revoked": 2, "request.api": 1}, got[metrics.AuditEventsWritten])
	})

	t.Run("a flush that failed", func(t *testing.T) {
		reader := setup(t)
		want := errors.New("boom")
		err := audit.NewMeteredBatchInserter(stubInserter{err: want}).InsertEvents(t.Context(), events)
		assert.Equal(t, want, err)

		got := read(t, reader)
		assert.Equal(t, map[string]uint64{"request": 1}, got[metrics.AuditInsertDuration])
		assert.NotContains(t, got, metrics.AuditEventsWritten)
	})
}
