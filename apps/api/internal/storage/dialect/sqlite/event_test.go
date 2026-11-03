//go:build sqlite_integration

package sqlite

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// An event is stamped after every event already stored in its project, even
// when the clock reads earlier. SQLite's one writer then commits a project's
// events in created_at order, and a reader's cursor never passes one that
// commits later.
func TestEventStatements_InsertStampsAfterStoredEvents(t *testing.T) {
	ctx := t.Context()
	projectID := "proj-" + t.Name()
	// Stored by a clock this one has not reached: it stepped back, or the
	// insert read it before waiting for the write lock.
	ahead := time.Now().Add(time.Hour).UnixNano()
	_, err := testPool.sqlDB.ExecContext(ctx,
		`INSERT INTO events (project_id, id, event_type, category, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		projectID, "evt-ahead", string(domain.EventTypeUserCreated), string(domain.EventCategoryEntity), ahead, ahead)
	require.NoError(t, err)

	stamped := &domain.Event{ProjectID: projectID, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity}
	require.NoError(t, testPool.InsertEvent(ctx, stamped))
	assert.Greater(t, stamped.CreatedAt.UnixNano(), ahead)

	other := &domain.Event{ProjectID: projectID + "-other", EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity}
	require.NoError(t, testPool.InsertEvent(ctx, other))
	assert.Less(t, other.CreatedAt.UnixNano(), ahead, "another project's events set no floor")
}
