//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func uniqueJobName(t *testing.T, kind string) string {
	t.Helper()
	return fmt.Sprintf("%s.%s", kind, strings.ReplaceAll(t.Name(), "/", "_"))
}

func TestJobStatements_Enqueue(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "email.send")
		job, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:        name,
			Payload:     []byte(`{"to":"a@b.c"}`),
			RunAt:       time.Now().UTC().Add(-time.Second),
			MaxAttempts: 5,
		})
		require.NoError(t, err)
		require.NotNil(t, job)
		assert.True(t, domain.PrefixJob.Matches(job.ID), "id %q", job.ID)
		assert.Equal(t, domain.JobStatusPending, job.Status)
		assert.Equal(t, name, job.Name)
	})
}

func TestJobStatements_Enqueue_Rollback(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "email.send")
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			_, err := tx.Statements().Enqueue(ctx, &domain.Job{
				Name:  name,
				RunAt: time.Now().UTC().Add(-time.Second),
			})
			require.NoError(t, err)
			return errors.New("rollback")
		})
		require.Error(t, err)

		results, err := d.stmts.Take(t.Context(), 10, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		assert.Empty(t, results)
	})
}

func TestJobStatements_Enqueue_UniqueKeyKeepWinner(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "email.send")
		key := name + ":user-1:welcome"
		first, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:        name,
			UniqueKey:   &key,
			RunAt:       time.Now().UTC().Add(-time.Second),
			MaxAttempts: 5,
		})
		require.NoError(t, err)

		second, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:        name,
			UniqueKey:   &key,
			Payload:     []byte("other"),
			RunAt:       time.Now().UTC().Add(-time.Second),
			MaxAttempts: 5,
		})
		require.NoError(t, err)
		require.NotNil(t, second)
		assert.Equal(t, first.ID, second.ID)

		results, err := d.stmts.Take(t.Context(), 10, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, results, 1)
		assert.Equal(t, first.ID, results[0].Job.ID)
	})
}

func TestJobStatements_Enqueue_UniqueKeyAfterDone(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "email.send")
		key := name + ":again"
		first, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:        name,
			UniqueKey:   &key,
			RunAt:       time.Now().UTC().Add(-time.Second),
			MaxAttempts: 5,
		})
		require.NoError(t, err)

		taken, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, taken, 1)
		require.NoError(t, d.stmts.Complete(t.Context(), taken[0].Job.ID, taken[0].LeaseToken))

		second, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:        name,
			UniqueKey:   &key,
			RunAt:       time.Now().UTC().Add(-time.Second),
			MaxAttempts: 5,
		})
		require.NoError(t, err)
		assert.NotEqual(t, first.ID, second.ID)
		assert.Equal(t, domain.JobStatusPending, second.Status)

		n, err := d.stmts.DeleteCompleted(t.Context(), time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)
		assert.GreaterOrEqual(t, n, int64(1))
	})
}

func TestJobStatements_SetPeriodic(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "sessions.gc")
		period := time.Minute
		runAt := time.Now().UTC().Add(-time.Second)
		sch, err := d.stmts.SetPeriodic(t.Context(), name, period, domain.PeriodicOpts{RunAt: &runAt})
		require.NoError(t, err)
		require.NotNil(t, sch)
		assert.True(t, domain.PrefixJobSchedule.Matches(sch.ID), "id %q", sch.ID)
		assert.Equal(t, name, sch.Name)
		assert.Equal(t, period, sch.Period)
	})
}

func TestJobStatements_SetPeriodic_NoClobberLiveLease(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "sessions.gc")
		runAt := time.Now().UTC().Add(-time.Second)
		first, err := d.stmts.SetPeriodic(t.Context(), name, time.Minute, domain.PeriodicOpts{RunAt: &runAt})
		require.NoError(t, err)

		taken, err := d.stmts.Take(t.Context(), 1, "worker-a", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, taken, 1)
		require.NotNil(t, taken[0].Schedule)
		leasedRunAt := taken[0].Schedule.RunAt
		leasedToken := taken[0].LeaseToken
		require.NotEmpty(t, leasedToken)

		updated, err := d.stmts.SetPeriodic(t.Context(), name, 5*time.Minute, domain.PeriodicOpts{})
		require.NoError(t, err)
		assert.Equal(t, 5*time.Minute, updated.Period)
		assert.Equal(t, first.ID, updated.ID)
		require.NotNil(t, updated.LeaseToken)
		assert.Equal(t, leasedToken, *updated.LeaseToken)
		assert.WithinDuration(t, leasedRunAt, updated.RunAt, time.Second)
	})
}

func TestJobStatements_Take_LeaseAndAllowlist(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		allowed := uniqueJobName(t, "sessions.gc")
		blocked := uniqueJobName(t, "future.job")
		_, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:  allowed,
			RunAt: time.Now().UTC().Add(-time.Second),
		})
		require.NoError(t, err)
		_, err = d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:  blocked,
			RunAt: time.Now().UTC().Add(-time.Second),
		})
		require.NoError(t, err)

		empty, err := d.stmts.Take(t.Context(), 10, "worker", 30*time.Second, nil)
		require.NoError(t, err)
		for _, r := range empty {
			assert.True(t, r.DeadOnTake, "empty allowlist must not lease for Perform")
		}

		taken, err := d.stmts.Take(t.Context(), 10, "worker", 30*time.Second, []string{allowed})
		require.NoError(t, err)
		require.Len(t, taken, 1)
		require.NotNil(t, taken[0].Job)
		assert.False(t, taken[0].DeadOnTake)
		assert.Equal(t, allowed, taken[0].Job.Name)
		assert.Equal(t, domain.JobStatusLeased, taken[0].Job.Status)
		assert.NotEmpty(t, taken[0].LeaseToken)
		require.NotNil(t, taken[0].Job.LeaseUntil)
		assert.True(t, taken[0].Job.LeaseUntil.After(time.Now().UTC()))

		still, err := d.stmts.Take(t.Context(), 10, "worker", 30*time.Second, []string{blocked})
		require.NoError(t, err)
		require.Len(t, still, 1)
		assert.Equal(t, blocked, still[0].Job.Name)
	})
}

func TestJobStatements_Take_ReclaimExpiredLease(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "work")
		_, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:  name,
			RunAt: time.Now().UTC().Add(-time.Second),
		})
		require.NoError(t, err)

		first, err := d.stmts.Take(t.Context(), 1, "worker-a", time.Millisecond, []string{name})
		require.NoError(t, err)
		require.Len(t, first, 1)
		oldToken := first[0].LeaseToken

		time.Sleep(20 * time.Millisecond)

		second, err := d.stmts.Take(t.Context(), 1, "worker-b", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, second, 1)
		assert.NotEqual(t, oldToken, second[0].LeaseToken)

		require.NoError(t, d.stmts.Complete(t.Context(), second[0].Job.ID, oldToken))
		require.NoError(t, d.stmts.Complete(t.Context(), second[0].Job.ID, second[0].LeaseToken))
	})
}

func TestJobStatements_Take_NotAfterDead(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "work")
		past := time.Now().UTC().Add(-time.Minute)
		_, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:     name,
			RunAt:    past,
			NotAfter: &past,
		})
		require.NoError(t, err)

		results, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, results, 1)
		assert.True(t, results[0].DeadOnTake)
		require.NotNil(t, results[0].Job)
		assert.Equal(t, domain.JobStatusDead, results[0].Job.Status)
		require.NotNil(t, results[0].Job.CompletedAt)
	})
}

func TestJobStatements_Take_IgnoresTerminalAndRespectsLimit(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "work")
		for i := 0; i < 3; i++ {
			_, err := d.stmts.Enqueue(t.Context(), &domain.Job{
				Name:  name,
				RunAt: time.Now().UTC().Add(-time.Second),
			})
			require.NoError(t, err)
		}
		first, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, first, 1)
		require.NoError(t, d.stmts.Complete(t.Context(), first[0].Job.ID, first[0].LeaseToken))

		second, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, second, 1)
		assert.NotEqual(t, first[0].Job.ID, second[0].Job.ID)
	})
}

func TestJobStatements_HeartbeatCompleteFail(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "work")
		_, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:        name,
			RunAt:       time.Now().UTC().Add(-time.Second),
			MaxAttempts: 5,
		})
		require.NoError(t, err)

		taken, err := d.stmts.Take(t.Context(), 1, "worker", time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, taken, 1)
		job := taken[0].Job
		token := taken[0].LeaseToken

		require.NoError(t, d.stmts.Heartbeat(t.Context(), job.ID, "OLD", 30*time.Second))
		require.NoError(t, d.stmts.Heartbeat(t.Context(), job.ID, token, 30*time.Second))
		require.NoError(t, d.stmts.Complete(t.Context(), job.ID, token))

		n, err := d.stmts.DeleteCompleted(t.Context(), time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)
		assert.GreaterOrEqual(t, n, int64(1))
	})
}

func TestJobStatements_Fail_RetryThenDead(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "work")
		_, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:        name,
			RunAt:       time.Now().UTC().Add(-time.Second),
			MaxAttempts: 2,
		})
		require.NoError(t, err)

		first, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, first, 1)
		require.NoError(t, d.stmts.Fail(t.Context(), first[0].Job.ID, first[0].LeaseToken, errors.New("boom"), time.Millisecond))

		time.Sleep(5 * time.Millisecond)
		second, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, second, 1)
		assert.Equal(t, 1, second[0].Job.Attempt)
		require.NoError(t, d.stmts.Fail(t.Context(), second[0].Job.ID, second[0].LeaseToken, errors.New("boom"), time.Millisecond))

		third, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		assert.Empty(t, third)

		n, err := d.stmts.DeleteCompleted(t.Context(), time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)
		assert.GreaterOrEqual(t, n, int64(1))
	})
}

func TestJobStatements_Periodic_CompleteAndFail(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "sessions.gc")
		period := time.Minute
		runAt := time.Now().UTC().Add(-time.Second)
		sch, err := d.stmts.SetPeriodic(t.Context(), name, period, domain.PeriodicOpts{RunAt: &runAt})
		require.NoError(t, err)

		taken, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, taken, 1)
		require.NotNil(t, taken[0].Schedule)
		beforeComplete := time.Now().UTC()
		require.NoError(t, d.stmts.Complete(t.Context(), taken[0].Schedule.ID, taken[0].LeaseToken))

		after, err := d.stmts.SetPeriodic(t.Context(), name, period, domain.PeriodicOpts{})
		require.NoError(t, err)
		assert.Equal(t, sch.ID, after.ID)
		assert.Nil(t, after.LeaseToken)
		assert.True(t, after.RunAt.After(beforeComplete.Add(period-2*time.Second)))
		assert.True(t, after.RunAt.Before(beforeComplete.Add(period+5*time.Second)))

		// Fail on a fresh due schedule: never dead; advances run_at like Complete.
		name2 := uniqueJobName(t, "sessions.gc2")
		runAt2 := time.Now().UTC().Add(-time.Second)
		_, err = d.stmts.SetPeriodic(t.Context(), name2, period, domain.PeriodicOpts{RunAt: &runAt2})
		require.NoError(t, err)
		leased, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name2})
		require.NoError(t, err)
		require.Len(t, leased, 1)
		beforeFail := time.Now().UTC()
		require.NoError(t, d.stmts.Fail(t.Context(), leased[0].Schedule.ID, leased[0].LeaseToken, errors.New("boom"), time.Second))

		afterFail, err := d.stmts.SetPeriodic(t.Context(), name2, period, domain.PeriodicOpts{})
		require.NoError(t, err)
		require.NotNil(t, afterFail.LastError)
		assert.Equal(t, "boom", *afterFail.LastError)
		assert.Nil(t, afterFail.LeaseToken)
		assert.True(t, afterFail.RunAt.After(beforeFail.Add(period-2*time.Second)))
	})
}

func TestJobStatements_DeleteCompleted(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		name := uniqueJobName(t, "work")
		done, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:  name,
			RunAt: time.Now().UTC().Add(-time.Second),
		})
		require.NoError(t, err)
		taken, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{name})
		require.NoError(t, err)
		require.Len(t, taken, 1)
		require.NoError(t, d.stmts.Complete(t.Context(), taken[0].Job.ID, taken[0].LeaseToken))

		pending, err := d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:  name + ".pending",
			RunAt: time.Now().UTC().Add(time.Hour),
		})
		require.NoError(t, err)

		leasedName := name + ".leased"
		_, err = d.stmts.Enqueue(t.Context(), &domain.Job{
			Name:  leasedName,
			RunAt: time.Now().UTC().Add(-time.Second),
		})
		require.NoError(t, err)
		leased, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{leasedName})
		require.NoError(t, err)
		require.Len(t, leased, 1)

		n, err := d.stmts.DeleteCompleted(t.Context(), time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)
		assert.GreaterOrEqual(t, n, int64(1))

		// Pending / leased still takeable or present.
		stillPending, err := d.stmts.Take(t.Context(), 1, "worker", 30*time.Second, []string{pending.Name})
		require.NoError(t, err)
		assert.Empty(t, stillPending, "pending with future run_at must not be taken")
		_ = done
		require.NoError(t, d.stmts.Complete(t.Context(), leased[0].Job.ID, leased[0].LeaseToken))
	})
}
