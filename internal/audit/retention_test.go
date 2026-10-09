package audit

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePurger struct {
	calls []time.Time
	n     int64
	err   error
}

func (f *fakePurger) DeleteEventsOlderThan(_ context.Context, createdBefore time.Time) (int64, error) {
	f.calls = append(f.calls, createdBefore)
	return f.n, f.err
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
