package audit

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePurger struct {
	mu    sync.Mutex
	calls []time.Time
	n     int64
	err   error
}

func (f *fakePurger) DeleteEventsOlderThan(_ context.Context, createdBefore time.Time) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, createdBefore)
	return f.n, f.err
}

func (f *fakePurger) Calls() []time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]time.Time(nil), f.calls...)
}

func TestRetentionJob_RunOnce(t *testing.T) {
	p := &fakePurger{n: 2}
	j := NewRetentionJob(p, RetentionConfig{
		Retention: time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	})
	j.runOnce()
	require.Len(t, p.calls, 1)
	assert.True(t, p.calls[0].Before(time.Now()))
}

func TestRetentionJob_CloseCancelsInFlightRun(t *testing.T) {
	started := make(chan struct{})
	p := &blockingPurger{started: started}
	j := NewRetentionJob(p, RetentionConfig{
		Retention: time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	})
	j.Start()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("purge did not start")
	}
	done := make(chan struct{})
	go func() {
		j.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not return")
	}
}

type blockingPurger struct {
	started chan struct{}
}

func (p *blockingPurger) DeleteEventsOlderThan(ctx context.Context, _ time.Time) (int64, error) {
	close(p.started)
	<-ctx.Done()
	return 0, ctx.Err()
}

// Start runs the loop unless retention is off. Whether Start is called at
// all is the lifecycle's: paused between requests the server's group does
// not call it.
func TestRetentionJob_StartRunsTheLoopUnlessRetentionIsOff(t *testing.T) {
	for _, tt := range []struct {
		name     string
		cfg      RetentionConfig
		wantLoop bool
	}{
		{name: "hourly in process", cfg: RetentionConfig{Enabled: true}, wantLoop: true},
		{name: "off", cfg: RetentionConfig{}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			p := &fakePurger{}
			j := NewRetentionJob(p, tt.cfg)
			j.Start()
			select {
			case <-j.done:
				assert.False(t, tt.wantLoop, "the loop must run")
				assert.Empty(t, p.Calls())
			default:
				assert.True(t, tt.wantLoop, "no loop may run")
			}
			j.Close()
		})
	}
}

// Once is the purge a call to the wake-up endpoint runs: one purge of what
// is older than the window, done when it returns.
func TestRetentionJob_OncePurgesOnce(t *testing.T) {
	p := &fakePurger{n: 2}
	before := time.Now().UTC()

	require.NoError(t, NewRetentionJob(p, RetentionConfig{Retention: time.Hour, Enabled: true}).Once(t.Context()))

	calls := p.Calls()
	require.Len(t, calls, 1, "one purge per call")
	assert.WithinRange(t, calls[0], before.Add(-time.Hour), time.Now().UTC().Add(-time.Hour), "events older than the window")
}

func TestRetentionJob_OnceReturnsAFailedPurge(t *testing.T) {
	failed := errors.New("failed to connect")

	err := NewRetentionJob(&fakePurger{err: failed}, RetentionConfig{Retention: time.Hour, Enabled: true}).Once(t.Context())

	assert.ErrorIs(t, err, failed, "the wake-up endpoint answers the scheduler with it")
}

// Once purges under its caller's deadline, not one of its own.
func TestRetentionJob_OnceEndsWithItsContext(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()

	err := NewRetentionJob(&blockingPurger{started: make(chan struct{})}, RetentionConfig{Retention: time.Hour, Enabled: true}).Once(ctx)

	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

// countingPurger counts its calls and blocks each until its context ends.
type countingPurger struct {
	mu      sync.Mutex
	calls   int
	started chan struct{}
}

func (p *countingPurger) DeleteEventsOlderThan(ctx context.Context, _ time.Time) (int64, error) {
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	p.started <- struct{}{}
	<-ctx.Done()
	return 0, ctx.Err()
}

// A second purge, a manual run beside the scheduled one, waits for the first
// instead of scanning the same rows at the same time.
func TestRetentionJob_PurgesOfOneProcessRunOneAfterTheOther(t *testing.T) {
	p := &countingPurger{started: make(chan struct{}, 2)}
	j := NewRetentionJob(p, RetentionConfig{Retention: time.Hour, Enabled: true})

	first, endFirst := context.WithCancel(t.Context())
	defer endFirst()
	go func() { _, _ = j.deleteExpired(first) }()
	<-p.started

	second, endSecond := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer endSecond()
	_, err := j.deleteExpired(second)

	assert.ErrorIs(t, err, context.DeadlineExceeded, "the second waited for the first until its own deadline")
	p.mu.Lock()
	defer p.mu.Unlock()
	assert.Equal(t, 1, p.calls, "the second never reached the database")
}
