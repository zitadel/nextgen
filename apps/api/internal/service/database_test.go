package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// eventPool is a pool that inserts events and nothing else. Its transaction
// runs the callback once per entry of attempts, as a dialect replays one
// that aborted, and commits the last unless that one failed.
type eventPool struct {
	// log is what happened, in order.
	log       *[]string
	attempts  int
	insertErr error
}

type eventStatements struct {
	AllStatements
	pool *eventPool
}

func (s eventStatements) InsertEvent(_ context.Context, event *domain.Event) error {
	if s.pool.insertErr != nil {
		return s.pool.insertErr
	}
	*s.pool.log = append(*s.pool.log, "insert "+string(event.EventType))
	return nil
}

func (p *eventPool) Statements() AllStatements { return eventStatements{pool: p} }

func (p *eventPool) Transaction(ctx context.Context, fn func(ctx context.Context, tx Statementer[AllStatements]) error) error {
	var err error
	for range max(p.attempts, 1) {
		err = fn(ctx, p)
	}
	if err != nil {
		*p.log = append(*p.log, "rollback")
		return err
	}
	*p.log = append(*p.log, "commit")
	return nil
}

func notifiedPool(pool *eventPool) (*DB, *[]string) {
	log := &[]string{}
	pool.log = log
	db := NewPool(pool)
	db.NotifyEventsStored(func(_ context.Context, projectID string, eventTypes []domain.EventType) {
		for _, eventType := range eventTypes {
			*log = append(*log, "stored "+projectID+" "+string(eventType))
		}
	})
	return db, log
}

func insert(projectID string, eventType domain.EventType) func(context.Context, Statementer[AllStatements]) error {
	return func(ctx context.Context, tx Statementer[AllStatements]) error {
		return tx.Statements().InsertEvent(ctx, &domain.Event{ProjectID: projectID, EventType: eventType})
	}
}

// A wake-up sent before the commit would find nothing to deliver.
func TestDB_EventsStoredIsToldAfterTheCommit(t *testing.T) {
	db, log := notifiedPool(&eventPool{})

	err := db.Transaction(t.Context(), func(ctx context.Context, tx Statementer[AllStatements]) error {
		require.NoError(t, insert("proj_a", domain.EventTypeUserCreated)(ctx, tx))
		return insert("proj_a", domain.EventTypeUserUpdated)(ctx, tx)
	})

	require.NoError(t, err)
	assert.Equal(t, []string{
		"insert user.created", "insert user.updated", "commit",
		"stored proj_a user.created", "stored proj_a user.updated",
	}, *log)
}

func TestDB_EventsStoredIsNotToldAfterARollback(t *testing.T) {
	db, log := notifiedPool(&eventPool{})
	failed := errors.New("the mutation failed")

	err := db.Transaction(t.Context(), func(ctx context.Context, tx Statementer[AllStatements]) error {
		require.NoError(t, insert("proj_a", domain.EventTypeUserCreated)(ctx, tx))
		return failed
	})

	require.ErrorIs(t, err, failed)
	assert.Equal(t, []string{"insert user.created", "rollback"}, *log)
}

func TestDB_EventsStoredIsNotToldOfAnInsertThatFailed(t *testing.T) {
	db, log := notifiedPool(&eventPool{insertErr: errors.New("failed to connect")})

	require.Error(t, db.Transaction(t.Context(), insert("proj_a", domain.EventTypeUserCreated)))
	require.Error(t, db.Statements().InsertEvent(t.Context(), &domain.Event{ProjectID: "proj_a", EventType: domain.EventTypeUserCreated}))
	assert.Equal(t, []string{"rollback"}, *log)
}

// A dialect replays the callback of a transaction that aborted: what is
// told is what the attempt that committed inserted, once.
func TestDB_EventsStoredIsToldOnceOfAReplayedTransaction(t *testing.T) {
	db, log := notifiedPool(&eventPool{attempts: 3})

	require.NoError(t, db.Transaction(t.Context(), insert("proj_a", domain.EventTypeUserCreated)))

	assert.Equal(t, []string{
		"insert user.created", "insert user.created", "insert user.created", "commit",
		"stored proj_a user.created",
	}, *log)
}

func TestDB_EventsStoredIsToldPerProject(t *testing.T) {
	db, log := notifiedPool(&eventPool{})

	err := db.Transaction(t.Context(), func(ctx context.Context, tx Statementer[AllStatements]) error {
		require.NoError(t, insert("proj_a", domain.EventTypeUserCreated)(ctx, tx))
		return insert("proj_b", domain.EventTypeUserCreated)(ctx, tx)
	})

	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"stored proj_a user.created", "stored proj_b user.created"}, (*log)[3:])
}

// Outside a transaction an insert is committed as it returns.
func TestDB_EventsStoredIsToldOfAnInsertOutsideATransaction(t *testing.T) {
	db, log := notifiedPool(&eventPool{})

	require.NoError(t, db.Statements().InsertEvent(t.Context(), &domain.Event{ProjectID: "proj_a", EventType: domain.EventTypeUserCreated}))

	assert.Equal(t, []string{"insert user.created", "stored proj_a user.created"}, *log)
}

// Nobody to tell: the pool's own statements, unwrapped, as before.
func TestDB_WithoutANotifierHandsOutThePoolsStatements(t *testing.T) {
	pool := &eventPool{log: &[]string{}}
	db := NewPool(pool)

	assert.IsType(t, eventStatements{}, db.Statements())
	require.NoError(t, db.Transaction(t.Context(), func(_ context.Context, tx Statementer[AllStatements]) error {
		assert.IsType(t, eventStatements{}, tx.Statements())
		return nil
	}))
}

// The request buffer's batch (Path A) goes through the same pool, so it
// wakes as a mutation's events do, once the batch is committed.
func TestEventExportAdapter_InsertEventsTellsOfTheBatch(t *testing.T) {
	db, log := notifiedPool(&eventPool{})

	err := EventExportAdapter{Pool: db}.InsertEvents(t.Context(), []*domain.Event{
		{ProjectID: "proj_a", EventType: domain.EventTypeRequestAPI},
		{ProjectID: "proj_a", EventType: domain.EventTypeRequestAPI},
	})

	require.NoError(t, err)
	assert.Equal(t, []string{
		"insert request.api", "insert request.api", "commit",
		"stored proj_a request.api", "stored proj_a request.api",
	}, *log)
}
