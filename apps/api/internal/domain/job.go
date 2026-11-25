package domain

import "time"

// PrefixJob is the dialect-minted ID prefix for queued job rows (job_<opaque>).
// Job rows are not HTTP resources (ADR 047 via ADR 065).
const PrefixJob ResourcePrefix = "job"

// PrefixJobSchedule is the dialect-minted ID prefix for job_schedules rows
// (sched_<opaque>). Schedule rows are not HTTP resources (ADR 047 via ADR 065).
const PrefixJobSchedule ResourcePrefix = "sched"

// JobStatus is the lifecycle of a queued jobs row.
type JobStatus string

const (
	JobStatusPending JobStatus = "pending"
	JobStatusLeased  JobStatus = "leased"
	JobStatusDone    JobStatus = "done"
	JobStatusDead    JobStatus = "dead"
)

// Job is a queued unit of work in the jobs table (ADR 065).
type Job struct {
	ID          string
	Name        string
	Payload     []byte
	UniqueKey   *string
	RunAt       time.Time
	NotAfter    *time.Time
	LeaseUntil  *time.Time
	LeaseBy     *string
	LeaseToken  *string
	Attempt     int
	MaxAttempts int
	LastError   *string
	Status      JobStatus
	CompletedAt *time.Time
}

// JobSchedule is a periodic definition in job_schedules (ADR 065).
type JobSchedule struct {
	ID         string
	Name       string
	Period     time.Duration
	RunAt      time.Time
	LeaseUntil *time.Time
	LeaseBy    *string
	LeaseToken *string
	LastError  *string
	Attempt    int
}

// PeriodicOpts seeds a schedule on insert. RunAt is ignored while a live lease
// holds the row; on insert, a nil RunAt means now + period.
type PeriodicOpts struct {
	RunAt *time.Time
}

// TakeResult is one row Take leased or expired without Perform (ADR 065).
// Exactly one of Job or Schedule is set. DeadOnTake is only set for queued
// rows past not_after.
type TakeResult struct {
	Job        *Job
	Schedule   *JobSchedule
	LeaseToken string
	DeadOnTake bool
}
