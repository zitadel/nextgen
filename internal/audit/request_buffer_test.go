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
}

func (c *channelInserter) InsertEvents(_ context.Context, events []*domain.Event) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	c.events = append(c.events, events...)
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
		BatchSize:     3,
		Capacity:      100,
		HighWatermark: 0.9,
		MaxAge:        time.Hour,
		FlushInterval: time.Hour,
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
		HighWatermark:   0, // disable watermark so capacity can fill
		MaxAge:          24 * time.Hour,
		FlushInterval:   24 * time.Hour,
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

func TestRequestBuffer_WatermarkFlush(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize:     100,
		Capacity:      10,
		HighWatermark: 0.8,
		MaxAge:        time.Hour,
		FlushInterval: time.Hour,
	})
	defer buf.Close()

	for i := 0; i < 8; i++ {
		buf.Enqueue(&domain.Event{ProjectID: "proj_1", EventType: domain.EventTypeRequestAPI, Category: domain.EventCategoryRequest})
	}
	require.Eventually(t, func() bool { return buf.Flushed() >= 8 }, time.Second, 10*time.Millisecond)
	assert.Equal(t, 1, ins.batchCalls())
}

func TestStatusCapturingWriter(t *testing.T) {
	rec := &statusCapturingWriter{ResponseWriter: nopResponseWriter{}, status: 0}
	rec.WriteHeader(http.StatusCreated)
	assert.Equal(t, http.StatusCreated, rec.status)
}

type nopResponseWriter struct{}

func (nopResponseWriter) Header() http.Header         { return http.Header{} }
func (nopResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (nopResponseWriter) WriteHeader(int)             {}
