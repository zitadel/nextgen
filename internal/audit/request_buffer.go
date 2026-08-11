package audit

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// RequestBufferConfig tunes Path A batching (ADR 048).
type RequestBufferConfig struct {
	BatchSize       int
	MaxAge          time.Duration
	Capacity        int
	HighWatermark   float64
	FlushInterval   time.Duration
	ShutdownTimeout time.Duration
}

func DefaultRequestBufferConfig() RequestBufferConfig {
	return RequestBufferConfig{
		BatchSize:       100,
		MaxAge:          time.Second,
		Capacity:        2000,
		HighWatermark:   0.8,
		FlushInterval:   100 * time.Millisecond,
		ShutdownTimeout: 5 * time.Second,
	}
}

type bufferedEvent struct {
	event      *domain.Event
	enqueuedAt time.Time
}

// RequestBuffer is an in-process Path A queue with N/T/watermark flush.
// A single background flusher owns all inserts (no per-enqueue goroutines).
type RequestBuffer struct {
	cfg     RequestBufferConfig
	insert  EventBatchInserter
	mu      sync.Mutex
	buf     []bufferedEvent
	dropped atomic.Uint64
	flushed atomic.Uint64
	wake    chan struct{}
	stop    chan struct{}
	done    chan struct{}
}

// NewRequestBuffer starts a background flusher. Call Close on shutdown.
func NewRequestBuffer(insert EventBatchInserter, cfg RequestBufferConfig) *RequestBuffer {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 100
	}
	if cfg.Capacity <= 0 {
		cfg.Capacity = 2000
	}
	if cfg.HighWatermark < 0 || cfg.HighWatermark > 1 {
		cfg.HighWatermark = 0.8
	}
	if cfg.MaxAge <= 0 {
		cfg.MaxAge = time.Second
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 100 * time.Millisecond
	}
	b := &RequestBuffer{
		cfg:    cfg,
		insert: insert,
		buf:    make([]bufferedEvent, 0, cfg.BatchSize),
		wake:   make(chan struct{}, 1),
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
	go b.loop()
	return b
}

// Enqueue adds a request event. Drops when full (never blocks).
func (b *RequestBuffer) Enqueue(ev *domain.Event) {
	if ev == nil || ev.ProjectID == "" {
		return
	}
	b.mu.Lock()
	if len(b.buf) >= b.cfg.Capacity {
		b.dropped.Add(1)
		slog.Warn("audit request buffer full; dropping event",
			slog.String("project_id", ev.ProjectID),
			slog.Uint64("dropped_total", b.dropped.Load()),
		)
		b.mu.Unlock()
		return
	}
	b.buf = append(b.buf, bufferedEvent{event: ev, enqueuedAt: time.Now()})
	shouldWake := b.shouldFlushLocked()
	b.mu.Unlock()
	if shouldWake {
		b.signal()
	}
}

func (b *RequestBuffer) signal() {
	select {
	case b.wake <- struct{}{}:
	default:
	}
}

func (b *RequestBuffer) shouldFlushLocked() bool {
	n := len(b.buf)
	if n == 0 {
		return false
	}
	if n >= b.cfg.BatchSize {
		return true
	}
	watermark := int(float64(b.cfg.Capacity) * b.cfg.HighWatermark)
	if watermark > 0 && n >= watermark {
		return true
	}
	oldest := b.buf[0].enqueuedAt
	return time.Since(oldest) >= b.cfg.MaxAge
}

func (b *RequestBuffer) takeAllLocked() []bufferedEvent {
	if len(b.buf) == 0 {
		return nil
	}
	batch := b.buf
	b.buf = make([]bufferedEvent, 0, b.cfg.BatchSize)
	return batch
}

func (b *RequestBuffer) loop() {
	defer close(b.done)
	ticker := time.NewTicker(b.cfg.FlushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-b.stop:
			b.mu.Lock()
			batch := b.takeAllLocked()
			b.mu.Unlock()
			b.flush(batch)
			return
		case <-b.wake:
			b.flushReady()
		case <-ticker.C:
			b.flushReady()
		}
	}
}

func (b *RequestBuffer) flushReady() {
	b.mu.Lock()
	var batch []bufferedEvent
	if b.shouldFlushLocked() {
		batch = b.takeAllLocked()
	}
	b.mu.Unlock()
	b.flush(batch)
}

func (b *RequestBuffer) flush(batch []bufferedEvent) {
	if len(batch) == 0 {
		return
	}
	events := make([]*domain.Event, len(batch))
	for i, item := range batch {
		ev := item.event
		ev.OccurredAtWait = time.Since(item.enqueuedAt)
		events[i] = ev
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.insert.InsertEvents(ctx, events); err != nil {
		slog.Error("failed to flush request audit event batch",
			slog.Int("batch_size", len(events)),
			slog.String("error", err.Error()),
		)
		return
	}
	b.flushed.Add(uint64(len(events)))
}

// Close drains the buffer and stops the flusher.
func (b *RequestBuffer) Close() {
	select {
	case <-b.stop:
		return
	default:
		close(b.stop)
	}
	timeout := b.cfg.ShutdownTimeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	select {
	case <-b.done:
	case <-time.After(timeout):
		slog.Warn("audit request buffer shutdown timed out")
	}
}

func (b *RequestBuffer) Dropped() uint64 { return b.dropped.Load() }

func (b *RequestBuffer) Flushed() uint64 { return b.flushed.Load() }

func (b *RequestBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.buf)
}
