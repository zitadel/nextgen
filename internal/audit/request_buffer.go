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
	ShutdownTimeout time.Duration
}

func DefaultRequestBufferConfig() RequestBufferConfig {
	return RequestBufferConfig{
		BatchSize:       100,
		MaxAge:          time.Second,
		Capacity:        2000,
		ShutdownTimeout: 5 * time.Second,
	}
}

func applyRequestBufferDefaults(cfg RequestBufferConfig) RequestBufferConfig {
	def := DefaultRequestBufferConfig()
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = def.BatchSize
	}
	if cfg.Capacity <= 0 {
		cfg.Capacity = def.Capacity
	}
	if cfg.MaxAge <= 0 {
		cfg.MaxAge = def.MaxAge
	}
	if cfg.ShutdownTimeout <= 0 {
		cfg.ShutdownTimeout = def.ShutdownTimeout
	}
	return cfg
}

type bufferedEvent struct {
	event      *domain.Event
	enqueuedAt time.Time
}

// RequestBuffer is an in-process Path A queue. Flush when the buffer holds at
// least BatchSize events (a prefix of that many) or the oldest event exceeds
// MaxAge. A single background flusher owns all inserts.
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
	cfg = applyRequestBufferDefaults(cfg)
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
	return time.Since(b.buf[0].enqueuedAt) >= b.cfg.MaxAge
}

func (b *RequestBuffer) takeReadyLocked() []bufferedEvent {
	if !b.shouldFlushLocked() {
		return nil
	}
	take := len(b.buf)
	if take > b.cfg.BatchSize {
		take = b.cfg.BatchSize
	}
	batch := append([]bufferedEvent(nil), b.buf[:take]...)
	b.buf = append([]bufferedEvent(nil), b.buf[take:]...)
	return batch
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
	ticker := time.NewTicker(b.cfg.MaxAge)
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
	for {
		b.mu.Lock()
		batch := b.takeReadyLocked()
		b.mu.Unlock()
		if len(batch) == 0 {
			return
		}
		b.flush(batch)
	}
}

func (b *RequestBuffer) flush(batch []bufferedEvent) {
	if len(batch) == 0 {
		return
	}
	events := make([]*domain.Event, len(batch))
	for i, item := range batch {
		events[i] = item.event
	}
	const maxAttempts = 3
	backoff := 50 * time.Millisecond
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		// Recompute wait immediately before each insert attempt so retries
		// include backoff time (review: OccurredAtWait on retry).
		for i, item := range batch {
			events[i].OccurredAtWait = time.Since(item.enqueuedAt)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		lastErr = b.insert.InsertEvents(ctx, events)
		cancel()
		if lastErr == nil {
			b.flushed.Add(uint64(len(events)))
			return
		}
		if attempt < maxAttempts {
			time.Sleep(backoff)
			backoff *= 2
		}
	}
	b.dropped.Add(uint64(len(events)))
	slog.Error("failed to flush request audit event batch; dropping after retries",
		slog.Int("batch_size", len(events)),
		slog.Uint64("dropped_total", b.dropped.Load()),
		slog.String("error", lastErr.Error()),
	)
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
		timeout = DefaultRequestBufferConfig().ShutdownTimeout
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
