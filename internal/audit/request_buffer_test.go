package audit

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

type channelInserter struct {
	mu     sync.Mutex
	events []*domain.Event
	calls  int
	waits  []time.Duration
}

func (c *channelInserter) InsertEvents(_ context.Context, events []*domain.Event) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	c.events = append(c.events, events...)
	for _, ev := range events {
		c.waits = append(c.waits, ev.OccurredAtWait)
	}
	return nil
}

func (c *channelInserter) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.events)
}

func (c *channelInserter) batchCalls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

func TestRequestBuffer_FlushOnBatchSize(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 3,
		Capacity:  100,
		MaxAge:    time.Hour,
	})
	defer buf.Close()

	for i := 0; i < 3; i++ {
		buf.Enqueue(&domain.Event{
			ProjectID: "proj_1",
			EventType: domain.EventTypeRequestAPI,
			Category:  domain.EventCategoryRequest,
		})
	}
	require.Eventually(t, func() bool { return buf.Flushed() >= 3 }, time.Second, 10*time.Millisecond)
	assert.Equal(t, 0, buf.Len())
	assert.GreaterOrEqual(t, ins.count(), 3)
	assert.Equal(t, 1, ins.batchCalls())
}

func TestRequestBuffer_DropWhenFull(t *testing.T) {
	ins := SequentialBatchInserter{Inner: noopInserter{}}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize:       1000,
		Capacity:        2,
		MaxAge:          24 * time.Hour,
		ShutdownTimeout: time.Millisecond,
	})
	t.Cleanup(buf.Close)

	buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	assert.Equal(t, 2, buf.Len())
	buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	assert.Equal(t, uint64(1), buf.Dropped())
	assert.Equal(t, 2, buf.Len())
}

type noopInserter struct{}

func (noopInserter) InsertEvent(context.Context, *domain.Event) error { return nil }

func TestRequestBuffer_BatchSizeTakesPrefix(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 3,
		Capacity:  100,
		MaxAge:    time.Hour,
	})
	defer buf.Close()

	for i := 0; i < 5; i++ {
		buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	}
	require.Eventually(t, func() bool { return buf.Flushed() >= 3 }, time.Second, 10*time.Millisecond)
	assert.Equal(t, uint64(3), buf.Flushed())
	assert.Equal(t, 2, buf.Len())
	assert.Equal(t, 1, ins.batchCalls())
}

func TestRequestBuffer_BatchSizeDrainsFullPrefixes(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 3,
		Capacity:  100,
		MaxAge:    time.Hour,
	})
	defer buf.Close()

	for i := 0; i < 7; i++ {
		buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	}
	require.Eventually(t, func() bool { return buf.Flushed() >= 6 && buf.Len() == 1 }, time.Second, 10*time.Millisecond)
	assert.Equal(t, uint64(6), buf.Flushed())
	assert.Equal(t, 1, buf.Len())
	assert.Equal(t, 2, ins.batchCalls())
}

func TestStatusCapturingWriter(t *testing.T) {
	rec := &statusCapturingWriter{ResponseWriter: nopResponseWriter{}, status: 0}
	rec.WriteHeader(http.StatusCreated)
	assert.Equal(t, http.StatusCreated, rec.status)
}

func TestStatusCapturingWriter_FlushAndUnwrap(t *testing.T) {
	inner := &flushableWriter{}
	rec := &statusCapturingWriter{ResponseWriter: inner}

	assert.Equal(t, http.ResponseWriter(inner), rec.Unwrap())

	flusher, ok := any(rec).(http.Flusher)
	require.True(t, ok)
	flusher.Flush()
	assert.Equal(t, 1, inner.flushCalls)
}

type nopResponseWriter struct{}

func (nopResponseWriter) Header() http.Header         { return http.Header{} }
func (nopResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (nopResponseWriter) WriteHeader(int)             {}

type flushableWriter struct {
	nopResponseWriter
	flushCalls int
}

func (w *flushableWriter) Flush() { w.flushCalls++ }

type failingInserter struct {
	calls int
}

func (f *failingInserter) InsertEvents(context.Context, []*domain.Event) error {
	f.calls++
	return assert.AnError
}

func TestRequestBuffer_FlushFailureDropsAndCounts(t *testing.T) {
	ins := &failingInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 2,
		Capacity:  100,
		MaxAge:    time.Hour,
	})
	defer buf.Close()

	buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})

	require.Eventually(t, func() bool { return buf.Dropped() >= 2 }, 2*time.Second, 20*time.Millisecond)
	assert.Equal(t, uint64(0), buf.Flushed())
	assert.Equal(t, 0, buf.Len())
	assert.Equal(t, 3, ins.calls)
}

type failThenSucceedInserter struct {
	mu        sync.Mutex
	calls     int
	lastWaits []time.Duration
}

func (f *failThenSucceedInserter) InsertEvents(_ context.Context, events []*domain.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastWaits = make([]time.Duration, len(events))
	for i, ev := range events {
		f.lastWaits[i] = ev.OccurredAtWait
	}
	if f.calls == 1 {
		return assert.AnError
	}
	return nil
}

func TestRequestBuffer_OccurredAtWaitIncludesRetryBackoff(t *testing.T) {
	ins := &failThenSucceedInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  100,
		MaxAge:    time.Hour,
	})
	defer buf.Close()

	buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Equal(t, 2, ins.calls)
	require.Len(t, ins.lastWaits, 1)
	// First attempt failed; second attempt wait must include the 50ms backoff.
	assert.GreaterOrEqual(t, ins.lastWaits[0], 50*time.Millisecond)
}

func TestRequestBuffer_OccurredAtWaitUsesRequestStart(t *testing.T) {
	ins := &failThenSucceedInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  100,
		MaxAge:    time.Hour,
	})
	defer buf.Close()

	started := time.Now().Add(-80 * time.Millisecond)
	buf.EnqueueSince(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest}, started)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.GreaterOrEqual(t, ins.calls, 1)
	require.Len(t, ins.lastWaits, 1)
	assert.GreaterOrEqual(t, ins.lastWaits[0], 80*time.Millisecond)
}

func TestRequestBuffer_MaxAgeUsesEnqueueTimeNotRequestStart(t *testing.T) {
	ins := SequentialBatchInserter{Inner: noopInserter{}}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize:       1000,
		Capacity:        10,
		MaxAge:          time.Hour,
		ShutdownTimeout: time.Millisecond,
	})
	t.Cleanup(buf.Close)

	buf.EnqueueSince(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest}, time.Now().Add(-2*time.Hour))
	assert.Equal(t, 1, buf.Len())
	assert.Equal(t, uint64(0), buf.Flushed())
}
