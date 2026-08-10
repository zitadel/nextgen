package audit

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeLister struct{ ids []string }
type fakePurger struct {
	calls []struct {
		projectID string
		before    time.Time
	}
	n int64
}

func (f fakeLister) ListProjectIDs(context.Context) ([]string, error) { return f.ids, nil }
func (f *fakePurger) DeleteEventsOlderThan(_ context.Context, projectID string, createdBefore time.Time) (int64, error) {
	f.calls = append(f.calls, struct {
		projectID string
		before    time.Time
	}{projectID, createdBefore})
	return f.n, nil
}

func TestRetentionJob_RunOnce(t *testing.T) {
	p := &fakePurger{n: 2}
	j := NewRetentionJob(fakeLister{ids: []string{"proj_a", "proj_b"}}, p, RetentionConfig{
		Retention: time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	})
	j.runOnce()
	require.Len(t, p.calls, 2)
	assert.Equal(t, "proj_a", p.calls[0].projectID)
	assert.Equal(t, "proj_b", p.calls[1].projectID)
	assert.True(t, p.calls[0].before.Before(time.Now()))
}
