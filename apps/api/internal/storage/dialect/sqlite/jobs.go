package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	jobColumns = `id, name, payload, unique_key, run_at, not_after, lease_until, lease_by, lease_token,` +
		` attempt, max_attempts, last_error, status, completed_at`
	jobScheduleColumns = `id, name, period, run_at, lease_until, lease_by, lease_token, last_error, attempt`

	insertJobStmt = `INSERT INTO jobs` +
		` (id, name, payload, unique_key, run_at, not_after, attempt, max_attempts, status)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` +
		` RETURNING ` + jobColumns

	insertJobUniqueStmt = `INSERT INTO jobs` +
		` (id, name, payload, unique_key, run_at, not_after, attempt, max_attempts, status)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` +
		` ON CONFLICT (unique_key) WHERE unique_key IS NOT NULL AND status IN ('pending', 'leased') DO NOTHING` +
		` RETURNING ` + jobColumns

	getLiveJobByUniqueKeyStmt = `SELECT ` + jobColumns + ` FROM jobs` +
		` WHERE unique_key = ? AND status IN ('pending', 'leased') LIMIT 1`

	insertJobScheduleStmt = `INSERT INTO job_schedules` +
		` (id, name, period, run_at, attempt)` +
		` VALUES (?, ?, ?, ?, 0)` +
		` ON CONFLICT (name) DO UPDATE SET period = excluded.period` +
		` RETURNING ` + jobScheduleColumns

	expireJobsStmt = `
UPDATE jobs SET
    status = 'dead',
    completed_at = ?,
    lease_until = NULL,
    lease_by = NULL,
    lease_token = NULL,
    last_error = COALESCE(last_error, 'not_after')
WHERE id IN (
    SELECT id FROM jobs
    WHERE status IN ('pending', 'leased')
      AND not_after IS NOT NULL AND not_after <= ?
      AND (status = 'pending' OR lease_until IS NULL OR lease_until <= ?)
    ORDER BY run_at, id
    LIMIT ?
)
RETURNING ` + jobColumns

	heartbeatJobStmt = `UPDATE jobs SET lease_until = ?` +
		` WHERE id = ? AND lease_token = ? AND status = 'leased'`

	heartbeatScheduleStmt = `UPDATE job_schedules SET lease_until = ?` +
		` WHERE id = ? AND lease_token = ? AND lease_until IS NOT NULL`

	completeJobStmt = `UPDATE jobs SET` +
		` status = 'done', completed_at = ?, attempt = 0,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL, last_error = NULL` +
		` WHERE id = ? AND lease_token = ? AND status = 'leased'`

	completeScheduleStmt = `UPDATE job_schedules SET` +
		` run_at = ? + period, attempt = 0,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL, last_error = NULL` +
		` WHERE id = ? AND lease_token = ? AND lease_until IS NOT NULL`

	failJobRetryStmt = `UPDATE jobs SET` +
		` status = 'pending', attempt = attempt + 1,` +
		` run_at = ?, last_error = ?,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = ? AND lease_token = ? AND status = 'leased'` +
		` AND (max_attempts <= 0 OR attempt + 1 < max_attempts)` +
		` AND (not_after IS NULL OR ? < not_after)`

	failJobDeadStmt = `UPDATE jobs SET` +
		` status = 'dead', completed_at = ?, attempt = attempt + 1,` +
		` last_error = ?,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = ? AND lease_token = ? AND status = 'leased'` +
		` AND (` +
		`   (max_attempts > 0 AND attempt + 1 >= max_attempts)` +
		`   OR (not_after IS NOT NULL AND ? >= not_after)` +
		` )`

	failScheduleStmt = `UPDATE job_schedules SET` +
		` run_at = ? + period, attempt = attempt + 1, last_error = ?,` +
		` lease_until = NULL, lease_by = NULL, lease_token = NULL` +
		` WHERE id = ? AND lease_token = ? AND lease_until IS NOT NULL`

	deleteCompletedJobsStmt = `DELETE FROM jobs` +
		` WHERE status IN ('done', 'dead') AND completed_at IS NOT NULL AND completed_at < ?`
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
	runAt := job.RunAt
	if runAt.IsZero() {
		runAt = time.Now().UTC()
	}
	args := []any{
		job.ID, job.Name, job.Payload, nullString(job.UniqueKey),
		runAt.UnixNano(), nullUnixNano(job.NotAfter),
		job.Attempt, job.MaxAttempts, string(domain.JobStatusPending),
	}
	stmt := insertJobStmt
	if job.UniqueKey != nil && *job.UniqueKey != "" {
		stmt = insertJobUniqueStmt
	}
	inserted, err := s.queryJob(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	if inserted == nil && job.UniqueKey != nil {
		return s.queryJob(ctx, getLiveJobByUniqueKeyStmt, *job.UniqueKey)
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
	return s.querySchedule(ctx, insertJobScheduleStmt, id, name, period.Nanoseconds(), runAt.UnixNano())
}

// Take implements [service.JobStatements].
func (s jobStatements) Take(ctx context.Context, limit int, leaseBy string, leaseFor time.Duration, names []string) ([]domain.TakeResult, error) {
	if limit <= 0 {
		return nil, nil
	}
	var out []domain.TakeResult
	err := withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		js := jobStatements{statement: statement{client: tx}}
		now := nowUnixNano()
		expired, err := js.expireJobs(ctx, now, limit)
		if err != nil {
			return err
		}
		out = append(out, expired...)
		remaining := limit - len(out)
		if remaining <= 0 || len(names) == 0 {
			return nil
		}
		leaseUntil := now + leaseFor.Nanoseconds()
		jobs, err := js.claimJobs(ctx, names, remaining, leaseBy, now, leaseUntil)
		if err != nil {
			return err
		}
		out = append(out, jobs...)
		remaining = limit - len(out)
		if remaining <= 0 {
			return nil
		}
		schedules, err := js.claimSchedules(ctx, names, remaining, leaseBy, now, leaseUntil)
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

func (s jobStatements) expireJobs(ctx context.Context, now int64, limit int) ([]domain.TakeResult, error) {
	rows, err := s.client.Query(ctx, expireJobsStmt, now, now, now, limit)
	if err != nil {
		return nil, wrapError(err)
	}
	jobs, err := collectRows(rows, scanJob)
	if err != nil {
		return nil, wrapError(err)
	}
	out := make([]domain.TakeResult, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, domain.TakeResult{Job: j, DeadOnTake: true})
	}
	return out, nil
}

func (s jobStatements) claimJobs(ctx context.Context, names []string, limit int, leaseBy string, now, leaseUntil int64) ([]domain.TakeResult, error) {
	var c statementCompiler
	c.WriteString(`UPDATE jobs SET status = 'leased', lease_until = `)
	c.WriteArg(leaseUntil)
	c.WriteString(`, lease_by = `)
	c.WriteArg(leaseBy)
	c.WriteString(`, lease_token = lower(hex(randomblob(16))) WHERE id IN (`)
	c.WriteString(`SELECT id FROM jobs WHERE status IN ('pending', 'leased') AND run_at <= `)
	c.WriteArg(now)
	c.WriteString(` AND (not_after IS NULL OR not_after > `)
	c.WriteArg(now)
	c.WriteString(`) AND (status = 'pending' OR lease_until IS NULL OR lease_until <= `)
	c.WriteArg(now)
	c.WriteString(`) AND name IN (`)
	for i, name := range names {
		if i > 0 {
			c.WriteString(`, `)
		}
		c.WriteArg(name)
	}
	c.WriteString(`) ORDER BY run_at, id LIMIT `)
	c.WriteArg(limit)
	c.WriteString(`) RETURNING `)
	c.WriteString(jobColumns)

	rows, err := s.client.Query(ctx, c.String(), c.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	jobs, err := collectRows(rows, scanJob)
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

func (s jobStatements) claimSchedules(ctx context.Context, names []string, limit int, leaseBy string, now, leaseUntil int64) ([]domain.TakeResult, error) {
	var c statementCompiler
	c.WriteString(`UPDATE job_schedules SET lease_until = `)
	c.WriteArg(leaseUntil)
	c.WriteString(`, lease_by = `)
	c.WriteArg(leaseBy)
	c.WriteString(`, lease_token = lower(hex(randomblob(16))) WHERE id IN (`)
	c.WriteString(`SELECT id FROM job_schedules WHERE run_at <= `)
	c.WriteArg(now)
	c.WriteString(` AND (lease_until IS NULL OR lease_until <= `)
	c.WriteArg(now)
	c.WriteString(`) AND name IN (`)
	for i, name := range names {
		if i > 0 {
			c.WriteString(`, `)
		}
		c.WriteArg(name)
	}
	c.WriteString(`) ORDER BY run_at, id LIMIT `)
	c.WriteArg(limit)
	c.WriteString(`) RETURNING `)
	c.WriteString(jobScheduleColumns)

	rows, err := s.client.Query(ctx, c.String(), c.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	schedules, err := collectRows(rows, scanJobSchedule)
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
	leaseUntil := nowUnixNano() + leaseFor.Nanoseconds()
	stmt := heartbeatJobStmt
	if domain.PrefixJobSchedule.Matches(id) {
		stmt = heartbeatScheduleStmt
	}
	_, err := s.client.Exec(ctx, stmt, leaseUntil, id, leaseToken)
	return wrapError(err)
}

// Complete implements [service.JobStatements].
func (s jobStatements) Complete(ctx context.Context, id, leaseToken string) error {
	now := nowUnixNano()
	if domain.PrefixJobSchedule.Matches(id) {
		_, err := s.client.Exec(ctx, completeScheduleStmt, now, id, leaseToken)
		return wrapError(err)
	}
	_, err := s.client.Exec(ctx, completeJobStmt, now, id, leaseToken)
	return wrapError(err)
}

// Fail implements [service.JobStatements].
func (s jobStatements) Fail(ctx context.Context, id, leaseToken string, cause error, backoff time.Duration) error {
	msg := ""
	if cause != nil {
		msg = cause.Error()
	}
	now := nowUnixNano()
	if domain.PrefixJobSchedule.Matches(id) {
		_, err := s.client.Exec(ctx, failScheduleStmt, now, msg, id, leaseToken)
		return wrapError(err)
	}
	nextRun := now + backoff.Nanoseconds()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		res, err := tx.Exec(ctx, failJobRetryStmt, nextRun, msg, id, leaseToken, nextRun)
		if err != nil {
			return wrapError(err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return wrapError(err)
		}
		if n > 0 {
			return nil
		}
		_, err = tx.Exec(ctx, failJobDeadStmt, now, msg, id, leaseToken, nextRun)
		return wrapError(err)
	})
}

// DeleteCompleted implements [service.JobStatements].
func (s jobStatements) DeleteCompleted(ctx context.Context, completedBefore time.Time) (int64, error) {
	res, err := s.client.Exec(ctx, deleteCompletedJobsStmt, completedBefore.UTC().UnixNano())
	if err != nil {
		return 0, wrapError(err)
	}
	return res.RowsAffected()
}

func (s jobStatements) queryJob(ctx context.Context, stmt string, args ...any) (*domain.Job, error) {
	rows, err := s.client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	job, err := collectExactlyOneRow(rows, scanJob)
	if errors.Is(err, sql.ErrNoRows) {
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
	sch, err := collectExactlyOneRow(rows, scanJobSchedule)
	if err != nil {
		return nil, wrapError(err)
	}
	return sch, nil
}

func scanJob(rows *sql.Rows) (*domain.Job, error) {
	var (
		j                                             domain.Job
		uniqueKey, leaseBy, leaseToken, lastError, st sql.NullString
		runAt, attempt, maxAttempts                   int64
		notAfter, leaseUntil, completedAt             sql.NullInt64
		payload                                       []byte
	)
	err := rows.Scan(
		&j.ID, &j.Name, &payload, &uniqueKey, &runAt, &notAfter,
		&leaseUntil, &leaseBy, &leaseToken, &attempt, &maxAttempts,
		&lastError, &st, &completedAt,
	)
	if err != nil {
		return nil, err
	}
	j.Payload = payload
	if j.Payload == nil {
		j.Payload = []byte{}
	}
	j.RunAt = timeFromUnixNano(runAt)
	j.Attempt = int(attempt)
	j.MaxAttempts = int(maxAttempts)
	j.UniqueKey = nullStringPtr(uniqueKey)
	j.LeaseBy = nullStringPtr(leaseBy)
	j.LeaseToken = nullStringPtr(leaseToken)
	j.LastError = nullStringPtr(lastError)
	j.Status = domain.JobStatus(st.String)
	if notAfter.Valid {
		t := timeFromUnixNano(notAfter.Int64)
		j.NotAfter = &t
	}
	if leaseUntil.Valid {
		t := timeFromUnixNano(leaseUntil.Int64)
		j.LeaseUntil = &t
	}
	if completedAt.Valid {
		t := timeFromUnixNano(completedAt.Int64)
		j.CompletedAt = &t
	}
	return &j, nil
}

func scanJobSchedule(rows *sql.Rows) (*domain.JobSchedule, error) {
	var (
		sch                            domain.JobSchedule
		period, runAt, attempt         int64
		leaseBy, leaseToken, lastError sql.NullString
		leaseUntil                     sql.NullInt64
	)
	err := rows.Scan(
		&sch.ID, &sch.Name, &period, &runAt,
		&leaseUntil, &leaseBy, &leaseToken, &lastError, &attempt,
	)
	if err != nil {
		return nil, err
	}
	sch.Period = time.Duration(period)
	sch.RunAt = timeFromUnixNano(runAt)
	sch.Attempt = int(attempt)
	sch.LeaseBy = nullStringPtr(leaseBy)
	sch.LeaseToken = nullStringPtr(leaseToken)
	sch.LastError = nullStringPtr(lastError)
	if leaseUntil.Valid {
		t := timeFromUnixNano(leaseUntil.Int64)
		sch.LeaseUntil = &t
	}
	return &sch, nil
}

var _ service.JobStatements = (*jobStatements)(nil)
