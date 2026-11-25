package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	jobColumns = `id, name, payload, unique_key, run_at, not_after, lease_until, lease_by, lease_token,` +
		` attempt, max_attempts, last_error, status, completed_at`
	// Qualified for UPDATE…FROM CTE RETURNING: bare "id" is ambiguous with picked.id.
	jobColumnsJ = `j.id, j.name, j.payload, j.unique_key, j.run_at, j.not_after, j.lease_until, j.lease_by, j.lease_token,` +
		` j.attempt, j.max_attempts, j.last_error, j.status, j.completed_at`
	jobScheduleColumns = `id, name, period, run_at, lease_until, lease_by, lease_token, last_error, attempt`
	jobScheduleColumnsS = `s.id, s.name, s.period, s.run_at, s.lease_until, s.lease_by, s.lease_token, s.last_error, s.attempt`

	insertJobStmt = `INSERT INTO zitadel_nextgen.jobs` +
		` (id, name, payload, unique_key, run_at, not_after, attempt, max_attempts, status)` +
		` VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)` +
		` RETURNING ` + jobColumns

	insertJobUniqueStmt = `INSERT INTO zitadel_nextgen.jobs` +
		` (id, name, payload, unique_key, run_at, not_after, attempt, max_attempts, status)` +
		` VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)` +
		` ON CONFLICT (unique_key) WHERE unique_key IS NOT NULL AND status IN ('pending', 'leased') DO NOTHING` +
		` RETURNING ` + jobColumns

	getLiveJobByUniqueKeyStmt = `SELECT ` + jobColumns + ` FROM zitadel_nextgen.jobs` +
		` WHERE unique_key = $1 AND status IN ('pending', 'leased') LIMIT 1`

	insertJobScheduleStmt = `INSERT INTO zitadel_nextgen.job_schedules` +
		` (id, name, period, run_at, attempt)` +
		` VALUES ($1, $2, $3::INTERVAL, $4, 0)` +
		` ON CONFLICT (name) DO UPDATE SET` +
		` period = EXCLUDED.period` +
		` RETURNING ` + jobScheduleColumns

	expireJobsStmt = `
WITH picked AS (
    SELECT id FROM zitadel_nextgen.jobs
    WHERE status IN ('pending', 'leased')
      AND not_after IS NOT NULL AND not_after <= NOW()
      AND (status = 'pending' OR lease_until IS NULL OR lease_until <= NOW())
    ORDER BY run_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT $1
)
UPDATE zitadel_nextgen.jobs j SET
    status = 'dead',
    completed_at = NOW(),
    lease_until = NULL,
    lease_by = NULL,
    lease_token = NULL,
    last_error = COALESCE(j.last_error, 'not_after')
FROM picked
WHERE j.id = picked.id
RETURNING ` + jobColumnsJ

	claimJobsStmt = `
WITH picked AS (
    SELECT id FROM zitadel_nextgen.jobs
    WHERE name = ANY($1)
      AND status IN ('pending', 'leased')
      AND run_at <= NOW()
      AND (not_after IS NULL OR not_after > NOW())
      AND (status = 'pending' OR lease_until IS NULL OR lease_until <= NOW())
    ORDER BY run_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT $2
)
UPDATE zitadel_nextgen.jobs j SET
    status = 'leased',
    lease_until = NOW() + $3::INTERVAL,
    lease_by = $4,
    lease_token = encode(gen_random_bytes(16), 'hex')
FROM picked
WHERE j.id = picked.id
RETURNING ` + jobColumnsJ

	claimSchedulesStmt = `
WITH picked AS (
    SELECT id FROM zitadel_nextgen.job_schedules
    WHERE name = ANY($1)
      AND run_at <= NOW()
      AND (lease_until IS NULL OR lease_until <= NOW())
    ORDER BY run_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT $2
)
UPDATE zitadel_nextgen.job_schedules s SET
    lease_until = NOW() + $3::INTERVAL,
    lease_by = $4,
    lease_token = encode(gen_random_bytes(16), 'hex')
FROM picked
WHERE s.id = picked.id
RETURNING ` + jobScheduleColumnsS

	heartbeatJobStmt = `UPDATE zitadel_nextgen.jobs` +
		` SET lease_until = NOW() + $3::INTERVAL` +
		` WHERE id = $1 AND lease_token = $2 AND status = 'leased'`

	heartbeatScheduleStmt = `UPDATE zitadel_nextgen.job_schedules` +
		` SET lease_until = NOW() + $3::INTERVAL` +
		` WHERE id = $1 AND lease_token = $2` +
		` AND lease_until IS NOT NULL`

	completeJobStmt = `UPDATE zitadel_nextgen.jobs SET` +
		` status = 'done', completed_at = NOW(), attempt = 0,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL, last_error = NULL` +
		` WHERE id = $1 AND lease_token = $2 AND status = 'leased'`

	completeScheduleStmt = `UPDATE zitadel_nextgen.job_schedules SET` +
		` run_at = NOW() + period, attempt = 0,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL, last_error = NULL` +
		` WHERE id = $1 AND lease_token = $2 AND lease_until IS NOT NULL`

	failJobRetryStmt = `UPDATE zitadel_nextgen.jobs SET` +
		` status = 'pending', attempt = attempt + 1,` +
		` run_at = NOW() + $3::INTERVAL, last_error = $4,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = $1 AND lease_token = $2 AND status = 'leased'` +
		` AND (max_attempts <= 0 OR attempt + 1 < max_attempts)` +
		` AND (not_after IS NULL OR NOW() + $3::INTERVAL < not_after)`

	failJobDeadStmt = `UPDATE zitadel_nextgen.jobs SET` +
		` status = 'dead', completed_at = NOW(), attempt = attempt + 1,` +
		` last_error = $3,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = $1 AND lease_token = $2 AND status = 'leased'` +
		` AND (` +
		`   (max_attempts > 0 AND attempt + 1 >= max_attempts)` +
		`   OR (not_after IS NOT NULL AND NOW() + $4::INTERVAL >= not_after)` +
		` )`

	failScheduleStmt = `UPDATE zitadel_nextgen.job_schedules SET` +
		` run_at = NOW() + period, attempt = attempt + 1, last_error = $3,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = $1 AND lease_token = $2 AND lease_until IS NOT NULL`

	deleteCompletedJobsStmt = `DELETE FROM zitadel_nextgen.jobs` +
		` WHERE status IN ('done', 'dead') AND completed_at IS NOT NULL AND completed_at < $1`
)

type jobStatements struct{ statement }

func newJobStatements(client queryExecutor) jobStatements {
	return jobStatements{statement: statement{client: client}}
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
	status := domain.JobStatusPending
	args := []any{
		job.ID, job.Name, job.Payload, nullString(job.UniqueKey),
		job.RunAt.UTC(), nullTime(job.NotAfter),
		job.Attempt, job.MaxAttempts, string(status),
	}

	var inserted *domain.Job
	var err error
	if job.UniqueKey != nil && *job.UniqueKey != "" {
		inserted, err = s.queryJob(ctx, insertJobUniqueStmt, args...)
		if err != nil {
			return nil, err
		}
		if inserted == nil {
			return s.queryJob(ctx, getLiveJobByUniqueKeyStmt, *job.UniqueKey)
		}
		return inserted, nil
	}
	inserted, err = s.queryJob(ctx, insertJobStmt, args...)
	if err != nil {
		return nil, err
	}
	return inserted, nil
}

// SetPeriodic implements [service.JobStatements].
func (s jobStatements) SetPeriodic(ctx context.Context, name string, period time.Duration, opts domain.PeriodicOpts) (*domain.JobSchedule, error) {
	if name == "" {
		return nil, fmt.Errorf("jobs: SetPeriodic requires name")
	}
	if period <= 0 {
		return nil, fmt.Errorf("jobs: SetPeriodic requires positive period")
	}
	id := ""
	if err := ensureManagedID(&id, domain.PrefixJobSchedule); err != nil {
		return nil, err
	}
	runAt := time.Now().UTC().Add(period)
	if opts.RunAt != nil {
		runAt = opts.RunAt.UTC()
	}
	return s.querySchedule(ctx, insertJobScheduleStmt, id, name, period, runAt)
}

// Take implements [service.JobStatements].
func (s jobStatements) Take(ctx context.Context, limit int, leaseBy string, leaseFor time.Duration, names []string) ([]domain.TakeResult, error) {
	if limit <= 0 {
		return nil, nil
	}
	var out []domain.TakeResult
	err := withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		js := jobStatements{statement: statement{client: tx}}
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
	rows, err := s.client.Query(ctx, expireJobsStmt, limit)
	if err != nil {
		return nil, wrapError(err)
	}
	jobs, err := pgx.CollectRows(rows, scanJob)
	if err != nil {
		return nil, wrapError(err)
	}
	out := make([]domain.TakeResult, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, domain.TakeResult{Job: j, DeadOnTake: true})
	}
	return out, nil
}

func (s jobStatements) claimJobs(ctx context.Context, names []string, limit int, leaseBy string, leaseFor time.Duration) ([]domain.TakeResult, error) {
	rows, err := s.client.Query(ctx, claimJobsStmt, names, limit, leaseFor, leaseBy)
	if err != nil {
		return nil, wrapError(err)
	}
	jobs, err := pgx.CollectRows(rows, scanJob)
	if err != nil {
		return nil, wrapError(err)
	}
	out := make([]domain.TakeResult, 0, len(jobs))
	for _, j := range jobs {
		tok := ""
		if j.LeaseToken != nil {
			tok = *j.LeaseToken
		}
		out = append(out, domain.TakeResult{Job: j, LeaseToken: tok})
	}
	return out, nil
}

func (s jobStatements) claimSchedules(ctx context.Context, names []string, limit int, leaseBy string, leaseFor time.Duration) ([]domain.TakeResult, error) {
	rows, err := s.client.Query(ctx, claimSchedulesStmt, names, limit, leaseFor, leaseBy)
	if err != nil {
		return nil, wrapError(err)
	}
	schedules, err := pgx.CollectRows(rows, scanJobSchedule)
	if err != nil {
		return nil, wrapError(err)
	}
	out := make([]domain.TakeResult, 0, len(schedules))
	for _, sch := range schedules {
		tok := ""
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
	_, err := s.client.Exec(ctx, stmt, id, leaseToken, leaseFor)
	return wrapError(err)
}

// Complete implements [service.JobStatements].
func (s jobStatements) Complete(ctx context.Context, id, leaseToken string) error {
	stmt := completeJobStmt
	if domain.PrefixJobSchedule.Matches(id) {
		stmt = completeScheduleStmt
	}
	_, err := s.client.Exec(ctx, stmt, id, leaseToken)
	return wrapError(err)
}

// Fail implements [service.JobStatements].
func (s jobStatements) Fail(ctx context.Context, id, leaseToken string, cause error, backoff time.Duration) error {
	msg := ""
	if cause != nil {
		msg = cause.Error()
	}
	if domain.PrefixJobSchedule.Matches(id) {
		_, err := s.client.Exec(ctx, failScheduleStmt, id, leaseToken, msg)
		return wrapError(err)
	}
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		tag, err := tx.Exec(ctx, failJobRetryStmt, id, leaseToken, backoff, msg)
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() > 0 {
			return nil
		}
		_, err = tx.Exec(ctx, failJobDeadStmt, id, leaseToken, msg, backoff)
		return wrapError(err)
	})
}

// DeleteCompleted implements [service.JobStatements].
func (s jobStatements) DeleteCompleted(ctx context.Context, completedBefore time.Time) (int64, error) {
	tag, err := s.client.Exec(ctx, deleteCompletedJobsStmt, completedBefore.UTC())
	if err != nil {
		return 0, wrapError(err)
	}
	return tag.RowsAffected(), nil
}

func (s jobStatements) queryJob(ctx context.Context, stmt string, args ...any) (*domain.Job, error) {
	rows, err := s.client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	job, err := pgx.CollectOneRow(rows, scanJob)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, wrapError(err)
	}
	return job, nil
}

func (s jobStatements) querySchedule(ctx context.Context, stmt string, args ...any) (*domain.JobSchedule, error) {
	rows, err := s.client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	sch, err := pgx.CollectExactlyOneRow(rows, scanJobSchedule)
	if err != nil {
		return nil, wrapError(err)
	}
	return sch, nil
}

func scanJob(row pgx.CollectableRow) (*domain.Job, error) {
	var (
		j                                             domain.Job
		uniqueKey, leaseBy, leaseToken, lastError, st sql.NullString
		notAfter, leaseUntil, completedAt             sql.NullTime
		payload                                       []byte
	)
	err := row.Scan(
		&j.ID, &j.Name, &payload, &uniqueKey, &j.RunAt, &notAfter,
		&leaseUntil, &leaseBy, &leaseToken, &j.Attempt, &j.MaxAttempts,
		&lastError, &st, &completedAt,
	)
	if err != nil {
		return nil, err
	}
	j.Payload = payload
	if j.Payload == nil {
		j.Payload = []byte{}
	}
	j.UniqueKey = nullStringPtr(uniqueKey)
	j.LeaseBy = nullStringPtr(leaseBy)
	j.LeaseToken = nullStringPtr(leaseToken)
	j.LastError = nullStringPtr(lastError)
	j.Status = domain.JobStatus(st.String)
	if notAfter.Valid {
		t := notAfter.Time
		j.NotAfter = &t
	}
	if leaseUntil.Valid {
		t := leaseUntil.Time
		j.LeaseUntil = &t
	}
	if completedAt.Valid {
		t := completedAt.Time
		j.CompletedAt = &t
	}
	return &j, nil
}

func scanJobSchedule(row pgx.CollectableRow) (*domain.JobSchedule, error) {
	var (
		sch                            domain.JobSchedule
		leaseBy, leaseToken, lastError sql.NullString
		leaseUntil                     sql.NullTime
	)
	err := row.Scan(
		&sch.ID, &sch.Name, &sch.Period, &sch.RunAt,
		&leaseUntil, &leaseBy, &leaseToken, &lastError, &sch.Attempt,
	)
	if err != nil {
		return nil, err
	}
	sch.LeaseBy = nullStringPtr(leaseBy)
	sch.LeaseToken = nullStringPtr(leaseToken)
	sch.LastError = nullStringPtr(lastError)
	if leaseUntil.Valid {
		t := leaseUntil.Time
		sch.LeaseUntil = &t
	}
	return &sch, nil
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC()
}

var _ service.JobStatements = (*jobStatements)(nil)
