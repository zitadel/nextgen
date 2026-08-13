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

func TestRetentionJob_RunOnce_PurgeError(t *testing.T) {
	p := &fakePurger{err: assert.AnError}
	j := NewRetentionJob(p, RetentionConfig{
		Retention: time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	})
	j.runOnce()
	require.Len(t, p.calls, 1)
}
