package audit

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
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
	buf.EnqueueSince(t.Context(), &domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest}, started)

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

	buf.EnqueueSince(t.Context(), &domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest}, time.Now().Add(-2*time.Hour))
	assert.Equal(t, 1, buf.Len())
	assert.Equal(t, uint64(0), buf.Flushed())
}

func requestEvent() *domain.Event {
	return &domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest}
}

// storeInserter keeps events as a storage dialect does: an event gets its id
// on its first insert and keeps it, and an id the store holds is refused as a
// duplicate. fail names the error an attempt reports after it stored its
// batch, by the attempt's number: the answer that got lost.
type storeInserter struct {
	mu     sync.Mutex
	calls  int
	stored map[string]bool
	fail   map[int]error
}

func (s *storeInserter) InsertEvents(_ context.Context, events []*domain.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.stored == nil {
		s.stored = map[string]bool{}
	}
	for i, ev := range events {
		if ev.ID == "" {
			ev.ID = fmt.Sprintf("evt_%d_%d", s.calls, i)
		}
		if s.stored[ev.ID] {
			return database.NewUniqueError("events", "events_pkey", errors.New("duplicate key value"))
		}
	}
	for _, ev := range events {
		s.stored[ev.ID] = true
	}
	return s.fail[s.calls]
}

func (s *storeInserter) state() (calls, stored int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls, len(s.stored)
}

// An instance paused mid-insert wakes to a failed attempt whose batch the
// database committed. The retry then meets its own rows, which is no loss.
func TestRequestBuffer_DuplicateAfterAFailedAttemptIsWritten(t *testing.T) {
	ins := &storeInserter{fail: map[int]error{1: context.DeadlineExceeded}}
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 2, Capacity: 100, MaxAge: time.Hour})
	defer buf.Close()

	buf.Enqueue(requestEvent())
	buf.Enqueue(requestEvent())

	require.Eventually(t, func() bool { return buf.Flushed() >= 2 }, 2*time.Second, 10*time.Millisecond)
	assert.Equal(t, uint64(0), buf.Dropped())
	calls, stored := ins.state()
	assert.Equal(t, 2, calls, "the attempt that met the duplicate is the last")
	assert.Equal(t, 2, stored)
}

// With no failed attempt before it, a duplicate is not this batch's own
// write, and a retry would only meet it again.
func TestRequestBuffer_DuplicateOnFirstAttemptIsDroppedAtOnce(t *testing.T) {
	ins := &storeInserter{stored: map[string]bool{"evt_taken": true}}
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 1, Capacity: 100, MaxAge: time.Hour})
	defer buf.Close()

	ev := requestEvent()
	ev.ID = "evt_taken"
	buf.Enqueue(ev)

	require.Eventually(t, func() bool { return buf.Dropped() >= 1 }, 2*time.Second, 10*time.Millisecond)
	assert.Equal(t, uint64(0), buf.Flushed())
	calls, _ := ins.state()
	assert.Equal(t, 1, calls)
}

type sequenceInserter struct {
	mu    sync.Mutex
	calls int
	errs  []error
}

func (s *sequenceInserter) InsertEvents(context.Context, []*domain.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.errs[min(s.calls, len(s.errs)-1)]
	s.calls++
	return err
}

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

// The last error of a batch that was given up on is often what the first
// attempt left behind, so the line names the first one too.
func TestRequestBuffer_GivingUpLogsTheFirstError(t *testing.T) {
	logs := &lockedBuffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	ins := &sequenceInserter{errs: []error{errors.New("connection reset"), errors.New("still unreachable")}}
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 1, Capacity: 100, MaxAge: time.Hour})
	defer buf.Close()

	buf.Enqueue(requestEvent())

	require.Eventually(t, func() bool { return bytes.Contains([]byte(logs.String()), []byte("dropping after retries")) }, 2*time.Second, 10*time.Millisecond)
	assert.Contains(t, logs.String(), `"error":"still unreachable"`)
	assert.Contains(t, logs.String(), `"first_error":"connection reset"`)
}

// A server that runs only while it serves a request has to write the event
// before the request ends: EnqueueSince returns with it written.
func TestRequestBuffer_FlushWaitWritesBeforeTheRequestEnds(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 100, Capacity: 100, MaxAge: time.Hour, FlushWait: 10 * time.Second})
	defer buf.Close()

	buf.EnqueueSince(t.Context(), requestEvent(), time.Now())

	assert.Equal(t, 1, ins.count())
	assert.Equal(t, uint64(1), buf.Flushed())
}

// gatedInserter reports each insert on entered and holds it until release.
type gatedInserter struct {
	channelInserter
	entered chan struct{}
	release chan struct{}
}

func newGatedInserter() *gatedInserter {
	return &gatedInserter{entered: make(chan struct{}, 16), release: make(chan struct{})}
}

func (g *gatedInserter) InsertEvents(ctx context.Context, events []*domain.Event) error {
	g.entered <- struct{}{}
	<-g.release
	return g.channelInserter.InsertEvents(ctx, events)
}

// A database that does not answer delays a request by FlushWait, not by the
// flusher's retries; the event is still written once it does.
func TestRequestBuffer_FlushWaitIsBounded(t *testing.T) {
	ins := newGatedInserter()
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 100, Capacity: 100, MaxAge: time.Hour, FlushWait: 30 * time.Millisecond})
	defer buf.Close()

	start := time.Now()
	buf.EnqueueSince(t.Context(), requestEvent(), start)
	waited := time.Since(start)

	assert.GreaterOrEqual(t, waited, 30*time.Millisecond)
	assert.Less(t, waited, 5*time.Second)
	assert.Equal(t, uint64(0), buf.Flushed())

	close(ins.release)
	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
}

// A request whose client is gone has nothing left to hold open.
func TestRequestBuffer_FlushWaitEndsWithTheRequest(t *testing.T) {
	ins := newGatedInserter()
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 100, Capacity: 100, MaxAge: time.Hour, FlushWait: time.Hour})
	defer buf.Close()
	defer close(ins.release)

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	returned := make(chan struct{})
	go func() {
		buf.EnqueueSince(ctx, requestEvent(), time.Now())
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(5 * time.Second):
		t.Fatal("EnqueueSince still waits after its context ended")
	}
}

// Requests that end while a write is under way share the next one, so the
// wait costs a busy instance one write per round, not one per request.
func TestRequestBuffer_FlushWaitSharesAWriteBetweenRequests(t *testing.T) {
	ins := newGatedInserter()
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 100, Capacity: 100, MaxAge: time.Hour, FlushWait: 10 * time.Second})
	defer buf.Close()

	var requests sync.WaitGroup
	enqueue := func() {
		requests.Go(func() { buf.EnqueueSince(t.Context(), requestEvent(), time.Now()) })
	}

	enqueue()
	<-ins.entered // the first request's write is under way
	enqueue()
	enqueue()
	require.Eventually(t, func() bool { return buf.Len() == 2 }, 2*time.Second, 5*time.Millisecond)

	ins.release <- struct{}{}
	<-ins.entered // the two that waited, in one write
	ins.release <- struct{}{}
	requests.Wait()

	assert.Equal(t, 2, ins.batchCalls())
	assert.Equal(t, 3, ins.count())
}
