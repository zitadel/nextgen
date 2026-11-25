package spanner

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	jobColumns = `id, name, payload, unique_key, run_at, not_after, lease_until, lease_by, lease_token,` +
		` attempt, max_attempts, last_error, status, completed_at`
	jobScheduleColumns = `id, name, period, run_at, lease_until, lease_by, lease_token, last_error, attempt`

	insertJobStmt = `INSERT INTO jobs` +
		` (id, name, payload, unique_key, active_unique_key, run_at, not_after, attempt, max_attempts, status)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10)`

	getLiveJobByUniqueKeyStmt = `SELECT ` + jobColumns + ` FROM jobs` +
		` WHERE active_unique_key = @p1 LIMIT 1`

	getJobByIDStmt = `SELECT ` + jobColumns + ` FROM jobs WHERE id = @p1`

	getScheduleByNameStmt = `SELECT ` + jobScheduleColumns + ` FROM job_schedules WHERE name = @p1`

	insertScheduleStmt = `INSERT INTO job_schedules` +
		` (id, name, period, run_at, attempt)` +
		` VALUES (@p1, @p2, @p3, @p4, 0)`

	updateSchedulePeriodStmt = `UPDATE job_schedules SET period = @p1 WHERE name = @p2`

	selectExpireJobIDsStmt = `
SELECT id FROM jobs
WHERE (status = 'pending' OR status = 'leased')
  AND not_after IS NOT NULL AND not_after <= CURRENT_TIMESTAMP()
  AND (status = 'pending' OR lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP())
ORDER BY run_at, id
LIMIT @p1`

	expireJobByIDStmt = `
UPDATE jobs SET
  status = 'dead',
  completed_at = CURRENT_TIMESTAMP(),
  lease_until = NULL,
  lease_by = NULL,
  lease_token = NULL,
  active_unique_key = NULL,
  last_error = IFNULL(last_error, 'not_after')
WHERE id = @p1
  AND (status = 'pending' OR status = 'leased')
  AND not_after IS NOT NULL AND not_after <= CURRENT_TIMESTAMP()
  AND (status = 'pending' OR lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP())
THEN RETURN ` + jobColumns

	selectClaimJobIDsStmt = `
SELECT id FROM jobs
WHERE name IN UNNEST(@p1)
  AND (status = 'pending' OR status = 'leased')
  AND run_at <= CURRENT_TIMESTAMP()
  AND (not_after IS NULL OR not_after > CURRENT_TIMESTAMP())
  AND (status = 'pending' OR lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP())
ORDER BY run_at, id
LIMIT @p2`

	claimJobByIDStmt = `
UPDATE jobs SET
  status = 'leased',
  lease_until = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @p2 NANOSECOND),
  lease_by = @p3,
  lease_token = @p4
WHERE id = @p1
  AND (status = 'pending' OR status = 'leased')
  AND run_at <= CURRENT_TIMESTAMP()
  AND (not_after IS NULL OR not_after > CURRENT_TIMESTAMP())
  AND (status = 'pending' OR lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP())
THEN RETURN ` + jobColumns

	selectClaimScheduleIDsStmt = `
SELECT id FROM job_schedules
WHERE name IN UNNEST(@p1)
  AND run_at <= CURRENT_TIMESTAMP()
  AND (lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP())
ORDER BY run_at, id
LIMIT @p2`

	claimScheduleByIDStmt = `
UPDATE job_schedules SET
  lease_until = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @p2 NANOSECOND),
  lease_by = @p3,
  lease_token = @p4
WHERE id = @p1
  AND run_at <= CURRENT_TIMESTAMP()
  AND (lease_until IS NULL OR lease_until <= CURRENT_TIMESTAMP())
THEN RETURN ` + jobScheduleColumns

	heartbeatJobStmt = `UPDATE jobs` +
		` SET lease_until = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @p3 NANOSECOND)` +
		` WHERE id = @p1 AND lease_token = @p2 AND status = 'leased'`

	heartbeatScheduleStmt = `UPDATE job_schedules` +
		` SET lease_until = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @p3 NANOSECOND)` +
		` WHERE id = @p1 AND lease_token = @p2 AND lease_until IS NOT NULL`

	completeJobStmt = `UPDATE jobs SET` +
		` status = 'done', completed_at = CURRENT_TIMESTAMP(), attempt = 0,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL, last_error = NULL,` +
		` active_unique_key = NULL` +
		` WHERE id = @p1 AND lease_token = @p2 AND status = 'leased'`

	completeScheduleStmt = `UPDATE job_schedules SET` +
		` run_at = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL period NANOSECOND), attempt = 0,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL, last_error = NULL` +
		` WHERE id = @p1 AND lease_token = @p2 AND lease_until IS NOT NULL`

	failJobRetryStmt = `UPDATE jobs SET` +
		` status = 'pending', attempt = attempt + 1,` +
		` run_at = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @p3 NANOSECOND), last_error = @p4,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = @p1 AND lease_token = @p2 AND status = 'leased'` +
		` AND (max_attempts <= 0 OR attempt + 1 < max_attempts)` +
		` AND (not_after IS NULL OR TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @p3 NANOSECOND) < not_after)`

	failJobDeadStmt = `UPDATE jobs SET` +
		` status = 'dead', completed_at = CURRENT_TIMESTAMP(), attempt = attempt + 1,` +
		` last_error = @p3,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL,` +
		` active_unique_key = NULL` +
		` WHERE id = @p1 AND lease_token = @p2 AND status = 'leased'` +
		` AND (` +
		`   (max_attempts > 0 AND attempt + 1 >= max_attempts)` +
		`   OR (not_after IS NOT NULL AND TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @p4 NANOSECOND) >= not_after)` +
		` )`

	failScheduleStmt = `UPDATE job_schedules SET` +
		` run_at = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL period NANOSECOND),` +
		` attempt = attempt + 1, last_error = @p3,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = @p1 AND lease_token = @p2 AND lease_until IS NOT NULL`

	deleteCompletedJobsStmt = `DELETE FROM jobs` +
		` WHERE (status = 'done' OR status = 'dead') AND completed_at IS NOT NULL AND completed_at < @p1`
)

type jobStatements struct{ statement }

func newJobStatements(db queryExecutor) jobStatements {
	return jobStatements{statement: statement{db: db}}
}

// Enqueue implements [service.JobStatements].
func (s jobStatements) Enqueue(ctx context.Context, job *domain.Job) (*domain.Job, error) {
	if job == nil {
		return nil, fmt.Errorf("jobs: enqueue nil job")
	}
	if job.Name == "" {
		return nil, fmt.Errorf("jobs: enqueue requires name")
	}
	if err := ensureManagedID(&job.ID, domain.PrefixJob); err != nil {
		return nil, err
	}
	if job.Payload == nil {
		job.Payload = []byte{}
	}
	if job.RunAt.IsZero() {
		job.RunAt = time.Now().UTC()
	}
	var activeUnique any
	if job.UniqueKey != nil && *job.UniqueKey != "" {
		activeUnique = *job.UniqueKey
	}

	var out *domain.Job
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		js := jobStatements{statement: statement{db: tx}}
		if job.UniqueKey != nil && *job.UniqueKey != "" {
			existing, err := js.getLiveByUniqueKey(ctx, *job.UniqueKey)
			if err != nil {
				return err
			}
			if existing != nil {
				out = existing
				return nil
			}
		}
		_, err := tx.Update(ctx, buildStatement(insertJobStmt,
			job.ID, job.Name, job.Payload, nullString(job.UniqueKey), activeUnique,
			job.RunAt.UTC(), spannerNullTime(job.NotAfter),
			int64(job.Attempt), int64(job.MaxAttempts), string(domain.JobStatusPending),
		).statement())
		if err != nil {
			// Concurrent insert of the same active_unique_key: keep the winner.
			if job.UniqueKey != nil && *job.UniqueKey != "" {
				if _, ok := errors.AsType[*database.UniqueError](err); ok {
					existing, getErr := js.getLiveByUniqueKey(ctx, *job.UniqueKey)
					if getErr != nil {
						return getErr
					}
					if existing != nil {
						out = existing
						return nil
					}
				}
			}
			return err
		}
		got, err := js.getJobByID(ctx, job.ID)
		if err != nil {
			return err
		}
		out = got
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SetPeriodic implements [service.JobStatements].
func (s jobStatements) SetPeriodic(ctx context.Context, name string, period time.Duration, opts domain.PeriodicOpts) (*domain.JobSchedule, error) {
	if name == "" {
		return nil, fmt.Errorf("jobs: SetPeriodic requires name")
	}
	if period <= 0 {
		return nil, fmt.Errorf("jobs: SetPeriodic requires positive period")
	}
	runAt := time.Now().UTC().Add(period)
	if opts.RunAt != nil {
		runAt = opts.RunAt.UTC()
	}
	var out *domain.JobSchedule
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		js := jobStatements{statement: statement{db: tx}}
		existing, err := js.getScheduleByName(ctx, name)
		if err != nil {
			return err
		}
		if existing != nil {
			if _, err := tx.Update(ctx, buildStatement(updateSchedulePeriodStmt, period.Nanoseconds(), name).statement()); err != nil {
				return err
			}
			existing.Period = period
			out = existing
			return nil
		}
		id := ""
		if err := ensureManagedID(&id, domain.PrefixJobSchedule); err != nil {
			return err
		}
		if _, err := tx.Update(ctx, buildStatement(insertScheduleStmt, id, name, period.Nanoseconds(), runAt).statement()); err != nil {
			return err
		}
		got, err := js.getScheduleByName(ctx, name)
		if err != nil {
			return err
		}
		out = got
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Take implements [service.JobStatements].
func (s jobStatements) Take(ctx context.Context, limit int, leaseBy string, leaseFor time.Duration, names []string) ([]domain.TakeResult, error) {
	if limit <= 0 {
		return nil, nil
	}
	var out []domain.TakeResult
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		js := jobStatements{statement: statement{db: tx}}
		expired, err := js.expireJobs(ctx, limit)
		if err != nil {
			return err
		}
		out = append(out, expired...)
		remaining := limit - len(out)
		if remaining <= 0 || len(names) == 0 {
			return nil
		}
		jobs, err := js.claimJobs(ctx, names, remaining, leaseBy, leaseFor)
		if err != nil {
			return err
		}
		out = append(out, jobs...)
		remaining = limit - len(out)
		if remaining <= 0 {
			return nil
		}
		schedules, err := js.claimSchedules(ctx, names, remaining, leaseBy, leaseFor)
		if err != nil {
			return err
		}
		out = append(out, schedules...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s jobStatements) expireJobs(ctx context.Context, limit int) ([]domain.TakeResult, error) {
	ids, err := s.queryIDs(ctx, buildStatement(selectExpireJobIDsStmt, int64(limit)).statement())
	if err != nil {
		return nil, err
	}
	out := make([]domain.TakeResult, 0, len(ids))
	for _, id := range ids {
		var job *domain.Job
		err := s.db.Write(ctx, buildStatement(expireJobByIDStmt, id).statement(), func(iter *spanner.RowIterator) error {
			var err error
			job, err = collectOneRow(iter, scanJob)
			return err
		})
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			return nil, err
		}
		out = append(out, domain.TakeResult{Job: job, DeadOnTake: true})
	}
	return out, nil
}

func (s jobStatements) claimJobs(ctx context.Context, names []string, limit int, leaseBy string, leaseFor time.Duration) ([]domain.TakeResult, error) {
	ids, err := s.queryIDs(ctx, buildStatement(selectClaimJobIDsStmt, names, int64(limit)).statement())
	if err != nil {
		return nil, err
	}
	out := make([]domain.TakeResult, 0, len(ids))
	for _, id := range ids {
		token, err := newLeaseToken()
		if err != nil {
			return nil, err
		}
		var job *domain.Job
		err = s.db.Write(ctx, buildStatement(claimJobByIDStmt, id, leaseFor.Nanoseconds(), leaseBy, token).statement(), func(iter *spanner.RowIterator) error {
			var err error
			job, err = collectOneRow(iter, scanJob)
			return err
		})
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			return nil, err
		}
		tok := token
		if job.LeaseToken != nil {
			tok = *job.LeaseToken
		}
		out = append(out, domain.TakeResult{Job: job, LeaseToken: tok})
	}
	return out, nil
}

func (s jobStatements) claimSchedules(ctx context.Context, names []string, limit int, leaseBy string, leaseFor time.Duration) ([]domain.TakeResult, error) {
	ids, err := s.queryIDs(ctx, buildStatement(selectClaimScheduleIDsStmt, names, int64(limit)).statement())
	if err != nil {
		return nil, err
	}
	out := make([]domain.TakeResult, 0, len(ids))
	for _, id := range ids {
		token, err := newLeaseToken()
		if err != nil {
			return nil, err
		}
		var sch *domain.JobSchedule
		err = s.db.Write(ctx, buildStatement(claimScheduleByIDStmt, id, leaseFor.Nanoseconds(), leaseBy, token).statement(), func(iter *spanner.RowIterator) error {
			var err error
			sch, err = collectOneRow(iter, scanJobSchedule)
			return err
		})
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			return nil, err
		}
		tok := token
		if sch.LeaseToken != nil {
			tok = *sch.LeaseToken
		}
		out = append(out, domain.TakeResult{Schedule: sch, LeaseToken: tok})
	}
	return out, nil
}

// Heartbeat implements [service.JobStatements].
func (s jobStatements) Heartbeat(ctx context.Context, id, leaseToken string, leaseFor time.Duration) error {
	stmt := heartbeatJobStmt
	if domain.PrefixJobSchedule.Matches(id) {
		stmt = heartbeatScheduleStmt
	}
	_, err := s.db.Update(ctx, buildStatement(stmt, id, leaseToken, leaseFor.Nanoseconds()).statement())
	return err
}

// Complete implements [service.JobStatements].
func (s jobStatements) Complete(ctx context.Context, id, leaseToken string) error {
	stmt := completeJobStmt
	if domain.PrefixJobSchedule.Matches(id) {
		stmt = completeScheduleStmt
	}
	_, err := s.db.Update(ctx, buildStatement(stmt, id, leaseToken).statement())
	return err
}

// Fail implements [service.JobStatements].
func (s jobStatements) Fail(ctx context.Context, id, leaseToken string, cause error, backoff time.Duration) error {
	msg := ""
	if cause != nil {
		msg = cause.Error()
	}
	if domain.PrefixJobSchedule.Matches(id) {
		_, err := s.db.Update(ctx, buildStatement(failScheduleStmt, id, leaseToken, msg).statement())
		return err
	}
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		n, err := tx.Update(ctx, buildStatement(failJobRetryStmt, id, leaseToken, backoff.Nanoseconds(), msg).statement())
		if err != nil {
			return err
		}
		if n > 0 {
			return nil
		}
		_, err = tx.Update(ctx, buildStatement(failJobDeadStmt, id, leaseToken, msg, backoff.Nanoseconds()).statement())
		return err
	})
}

// DeleteCompleted implements [service.JobStatements].
func (s jobStatements) DeleteCompleted(ctx context.Context, completedBefore time.Time) (int64, error) {
	return s.db.Update(ctx, buildStatement(deleteCompletedJobsStmt, completedBefore.UTC()).statement())
}

func (s jobStatements) getLiveByUniqueKey(ctx context.Context, key string) (*domain.Job, error) {
	var job *domain.Job
	err := s.db.Query(ctx, buildStatement(getLiveJobByUniqueKeyStmt, key).statement(), func(iter *spanner.RowIterator) error {
		var err error
		job, err = collectOneRow(iter, scanJob)
		return err
	})
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, nil
		}
		return nil, err
	}
	return job, nil
}

func (s jobStatements) getJobByID(ctx context.Context, id string) (*domain.Job, error) {
	var job *domain.Job
	err := s.db.Query(ctx, buildStatement(getJobByIDStmt, id).statement(), func(iter *spanner.RowIterator) error {
		var err error
		job, err = collectOneRow(iter, scanJob)
		return err
	})
	if err != nil {
		return nil, err
	}
	return job, nil
}

func (s jobStatements) getScheduleByName(ctx context.Context, name string) (*domain.JobSchedule, error) {
	var sch *domain.JobSchedule
	err := s.db.Query(ctx, buildStatement(getScheduleByNameStmt, name).statement(), func(iter *spanner.RowIterator) error {
		var err error
		sch, err = collectOneRow(iter, scanJobSchedule)
		return err
	})
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, nil
		}
		return nil, err
	}
	return sch, nil
}

func (s jobStatements) queryIDs(ctx context.Context, stmt spanner.Statement) ([]string, error) {
	var ids []string
	err := s.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		ids, err = collectRows(iter, func(row *spanner.Row) (string, error) {
			var id string
			if err := row.Columns(&id); err != nil {
				return "", err
			}
			return id, nil
		})
		return err
	})
	return ids, err
}

func scanJob(row *spanner.Row) (*domain.Job, error) {
	var (
		j                                         domain.Job
		uniqueKey, leaseBy, leaseToken, lastError spanner.NullString
		notAfter, leaseUntil, completedAt         spanner.NullTime
		payload                                   []byte
		attempt, maxAttempts                      int64
		status                                    string
	)
	if err := row.Columns(
		&j.ID, &j.Name, &payload, &uniqueKey, &j.RunAt, &notAfter,
		&leaseUntil, &leaseBy, &leaseToken, &attempt, &maxAttempts,
		&lastError, &status, &completedAt,
	); err != nil {
		return nil, err
	}
	j.Payload = payload
	if j.Payload == nil {
		j.Payload = []byte{}
	}
	j.RunAt = j.RunAt.UTC()
	j.Attempt = int(attempt)
	j.MaxAttempts = int(maxAttempts)
	j.UniqueKey = spannerNullStringPtr(uniqueKey)
	j.LeaseBy = spannerNullStringPtr(leaseBy)
	j.LeaseToken = spannerNullStringPtr(leaseToken)
	j.LastError = spannerNullStringPtr(lastError)
	j.Status = domain.JobStatus(status)
	if notAfter.Valid {
		t := notAfter.Time.UTC()
		j.NotAfter = &t
	}
	if leaseUntil.Valid {
		t := leaseUntil.Time.UTC()
		j.LeaseUntil = &t
	}
	if completedAt.Valid {
		t := completedAt.Time.UTC()
		j.CompletedAt = &t
	}
	return &j, nil
}

func scanJobSchedule(row *spanner.Row) (*domain.JobSchedule, error) {
	var (
		sch                            domain.JobSchedule
		period, attempt                int64
		leaseBy, leaseToken, lastError spanner.NullString
		leaseUntil                     spanner.NullTime
	)
	if err := row.Columns(
		&sch.ID, &sch.Name, &period, &sch.RunAt,
		&leaseUntil, &leaseBy, &leaseToken, &lastError, &attempt,
	); err != nil {
		return nil, err
	}
	sch.Period = time.Duration(period)
	sch.RunAt = sch.RunAt.UTC()
	sch.Attempt = int(attempt)
	sch.LeaseBy = spannerNullStringPtr(leaseBy)
	sch.LeaseToken = spannerNullStringPtr(leaseToken)
	sch.LastError = spannerNullStringPtr(lastError)
	if leaseUntil.Valid {
		t := leaseUntil.Time.UTC()
		sch.LeaseUntil = &t
	}
	return &sch, nil
}

func newLeaseToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("jobs: lease token: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

var _ service.JobStatements = (*jobStatements)(nil)
