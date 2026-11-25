//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/jobs"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// TestSessionsGC_RunDueOnce_ReapsExpiredSession mirrors sessions-gc.feature:
// pre-expired session → SetPeriodic + RunDueOnce → session gone + session.expired.
func TestSessionsGC_RunDueOnce_ReapsExpiredSession(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		projectID := uniqueProjectID(t)
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), projectID) })

		session, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		session.TimeToLive = time.Nanosecond
		require.NoError(t, d.stmts.CreateSession(t.Context(), session))
		sessionID := session.ID

		_, err = d.stmts.GetSessionByID(t.Context(), projectID, sessionID)
		require.NoError(t, err)
		require.True(t, session.ExpiresAt.Before(time.Now().UTC().Add(time.Second)),
			"fixture must be expired or about to be: expires_at=%s", session.ExpiresAt)

		// Wait past the 1ns TTL so expires_at < now on the database clock.
		time.Sleep(5 * time.Millisecond)

		engine := jobs.New(jobs.PoolTransactor(d.pool), jobs.DefaultConfig())
		gc := service.NewSessionsGC(d.pool, service.SessionsGCConfig{BatchSize: 100})
		require.NoError(t, engine.RegisterWorker("test", service.JobNameSessionsGC, func(ctx context.Context, _ jobs.Work) error {
			return gc.Perform(ctx)
		}, jobs.WorkerOpts{}))

		runAt := time.Now().UTC().Add(-time.Second)
		require.NoError(t, d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			_, err := tx.Statements().SetPeriodic(ctx, service.JobNameSessionsGC, time.Minute, domain.PeriodicOpts{RunAt: &runAt})
			return err
		}))

		ran, err := engine.RunDueOnce(t.Context(), 1)
		require.NoError(t, err)
		assert.Equal(t, 1, ran)

		_, err = d.stmts.GetSessionByID(t.Context(), projectID, sessionID)
		require.ErrorIs(t, err, domain.ErrSessionNotFound())

		events, err := d.stmts.ListEvents(t.Context(), &database.ListOptions[domain.EventField]{
			Filter: database.And(
				database.Equal(database.Col(domain.EventFieldProjectID), projectID),
				database.Equal(database.Col(domain.EventFieldEventType), string(domain.EventTypeSessionExpired)),
			),
			Pagination: database.Page[domain.EventField]{
				Limit: 10,
				OrderBy: database.OrderBy[domain.EventField]{
					Columns: []database.Column[domain.EventField]{database.Col(domain.EventFieldID)},
				},
			},
		})
		require.NoError(t, err)
		require.Len(t, events.Items, 1)
		ev := events.Items[0]
		require.NotNil(t, ev.EntityID)
		assert.Equal(t, sessionID, *ev.EntityID)
		require.NotNil(t, ev.ActorType)
		assert.Equal(t, domain.EventActorTypeSystem, *ev.ActorType)

		// Second drain: idempotent (schedule may not be due yet; empty Take is fine).
		_, err = engine.RunDueOnce(t.Context(), 1)
		require.NoError(t, err)
	})
}
