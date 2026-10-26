package audit

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// The reader is cumulative and shared by the whole binary, so every test here
// asserts the change it caused and none of them runs in parallel.

type failingEventInserter struct{ err error }

func (f failingEventInserter) InsertEvent(context.Context, *domain.Event) error { return f.err }

func source(v metrics.AuditSource) attribute.KeyValue { return metrics.SourceKey.String(string(v)) }

func eventType(v domain.EventType) attribute.KeyValue { return metrics.EventTypeKey.String(string(v)) }

func TestInsert_metrics(t *testing.T) {
	for _, tc := range []struct {
		name        string
		insertErr   error
		wantWritten int64
	}{
		{"written", nil, 1},
		{"insert failed", errors.New("down"), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ev := FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
			ev.ProjectID = "proj_1"
			durationBefore := metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditEvent))
			writtenBefore := metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeUserCreated))

			err := Insert(t.Context(), failingEventInserter{err: tc.insertErr}, ev)
			require.ErrorIs(t, err, tc.insertErr)

			assert.Equal(t, uint64(1), metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditEvent))-durationBefore, "insert duration")
			assert.Equal(t, tc.wantWritten, metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeUserCreated))-writtenBefore, "events written")
		})
	}
}

// An insert skipped for want of a project is not a write and takes no time
// worth recording.
func TestInsert_metrics_skipped(t *testing.T) {
	durationBefore := metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditEvent))
	ev := FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	require.NoError(t, Insert(t.Context(), failingEventInserter{err: errors.New("never called")}, ev))
	assert.Equal(t, uint64(0), metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditEvent))-durationBefore)
}

// One flush is one insert, and the events it carried are counted per type.
func TestRequestBuffer_flush_metrics(t *testing.T) {
	durationBefore := metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditRequest))
	apiBefore := metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeRequestAPI))
	otherBefore := metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeUserCreated))

	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 3, Capacity: 100, MaxAge: time.Hour})
	defer buf.Close()
	// The buffer does not care about the type; a second one shows the count
	// is split by it.
	for _, typ := range []domain.EventType{domain.EventTypeRequestAPI, domain.EventTypeUserCreated, domain.EventTypeRequestAPI} {
		buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: typ, Category: domain.EventCategoryRequest})
	}
	require.Eventually(t, func() bool { return buf.Flushed() >= 3 }, time.Second, 10*time.Millisecond)
	require.Equal(t, 1, ins.batchCalls())

	assert.Equal(t, uint64(1), metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditRequest))-durationBefore, "flush duration")
	assert.Equal(t, int64(2), metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeRequestAPI))-apiBefore, "api requests written")
	assert.Equal(t, int64(1), metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeUserCreated))-otherBefore, "the other type written")
}

// A flush that storage refuses is timed but counts no event as written.
func TestRequestBuffer_flush_metrics_dropped(t *testing.T) {
	durationBefore := metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditRequest))
	apiBefore := metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeRequestAPI))

	ins := &failingInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 1, Capacity: 100, MaxAge: time.Hour})
	defer buf.Close()
	buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	require.Eventually(t, func() bool { return buf.Dropped() >= 1 }, 5*time.Second, 10*time.Millisecond)

	assert.GreaterOrEqual(t, metricsReader.HistogramCount(t, metrics.AuditInsertDuration, source(metrics.AuditRequest))-durationBefore, uint64(1), "every attempt is timed")
	assert.Equal(t, int64(0), metricsReader.CounterSum(t, metrics.AuditEventsWritten, eventType(domain.EventTypeRequestAPI))-apiBefore, "nothing written")
}
