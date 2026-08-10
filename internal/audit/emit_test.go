package audit_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
)

type insertEventCapture struct {
	called int
	last   *domain.Event
	err    error
}

func (c *insertEventCapture) InsertEvent(_ context.Context, event *domain.Event) error {
	c.called++
	c.last = event
	return c.err
}

func TestInsert_NoopsEmptyProjectID(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ev := audit.FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	require.NoError(t, audit.Insert(t.Context(), cap, ev))
	require.Equal(t, 0, cap.called)
}

func TestInsert_CallsInsertEvent(t *testing.T) {
	t.Parallel()
	cap := &insertEventCapture{}
	ev := audit.FromContext(t.Context(), domain.EventTypeUserCreated, domain.EventCategoryEntity)
	ev.ProjectID = "proj_1"
	require.NoError(t, audit.Insert(t.Context(), cap, ev))
	require.Equal(t, 1, cap.called)
	require.Equal(t, ev, cap.last)
}
