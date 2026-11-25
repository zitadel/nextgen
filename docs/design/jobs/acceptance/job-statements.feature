# JobStatements storage contract — portable across postgres, spanner, sqlite.
# Automate with @stmttest / forEachDialect. No goroutines; statements stay tx-passive.
# Queued work lives in `jobs` (has status). Periodic work lives in `job_schedules`
# (no status / unique_key; Take returns TakeResult.Schedule).

@stmttest @dialect-parity @slice1
Feature: JobStatements storage contract
  As the jobs Engine and product services
  I need a portable Enqueue / SetPeriodic / Take / Heartbeat / Complete / Fail / DeleteCompleted surface
  So that every dialect shares one ownership protocol with dialect-private claim SQL

  Background:
    Given a fresh database for the current dialect
    And JobStatements are available on AllStatements

  # --- Enqueue (queued jobs table) ---

  @enqueue
  Scenario: Enqueue inserts a queued job on the caller's transaction
    Given I open a write transaction
    When I Enqueue a queued job named "email.send" with no unique_key due now
    And I commit the transaction
    Then the job exists with status "pending"
    And the job id is dialect-minted with prefix "job"

  @enqueue
  Scenario: Enqueue is gone if the product transaction rolls back
    Given I open a write transaction
    When I Enqueue a queued job named "email.send" due now
    And I roll back the transaction
    Then no job named "email.send" exists

  @enqueue @unique_key
  Scenario: Enqueue with a live unique_key keeps the existing row
    Given a live queued job with unique_key "email.send:user-1:welcome" and status "pending"
    When I Enqueue another job with the same unique_key
    Then exactly one live row has that unique_key
    And the call succeeds without failing the caller's transaction
    And the returned job is the existing row

  @enqueue @unique_key
  Scenario: Enqueue may insert again after the previous row is terminal
    Given a queued job with unique_key "email.send:user-1:welcome" and status "done"
    When I Enqueue another job with the same unique_key
    Then a new pending row exists with that unique_key
    And the previous done row still exists until DeleteCompleted

  # --- SetPeriodic (job_schedules table) ---

  @periodic @SetPeriodic
  Scenario: SetPeriodic creates a periodic schedule due according to period
    When I SetPeriodic name "sessions.gc" with period "1m"
    Then a job_schedules row exists for name "sessions.gc"
    And the schedule id is dialect-minted with prefix "sched"
    And name "sessions.gc" is unique on job_schedules
    And the next run_at is due at now plus the period or sooner per PeriodicOpts.RunAt
    And the schedule has no status or unique_key column

  @periodic @SetPeriodic
  Scenario: SetPeriodic updates period from config without clobbering a live lease
    Given a job_schedules row "sessions.gc" that is leased with a valid lease_token
    And its run_at is in the future relative to a mid-lease clock
    When I SetPeriodic name "sessions.gc" with period "5m"
    Then the stored period is "5m"
    And lease_until, lease_by, lease_token are unchanged
    And run_at is unchanged while the lease is live

  # --- Take (queued) ---

  @take
  Scenario: Take leases a due pending queued job and returns a fencing token
    Given a pending queued job named "work" with run_at in the past
    When the Engine Takes with limit 1, lease duration "30s", and names ["work"]
    Then one TakeResult is returned with DeadOnTake false and Job set
    And the job status is "leased"
    And lease_token is non-empty
    And lease_until is approximately now plus "30s" on the database clock

  @take @periodic
  Scenario: Take leases a due schedule and returns a fencing token
    Given a due job_schedules row named "sessions.gc" with run_at in the past
    When the Engine Takes with limit 1, lease duration "30s", and names ["sessions.gc"]
    Then one TakeResult is returned with DeadOnTake false and Schedule set
    And Job is nil
    And lease_token is non-empty
    And lease_until is approximately now plus "30s" on the database clock

  @take
  Scenario: Take reclaims a lease-expired queued job
    Given a queued job named "work" with status "leased" and lease_until in the past
    When the Engine Takes with limit 1 and names ["work"]
    Then the job is leased again with a new lease_token

  @take @allowlist
  Scenario: Take does not lease names outside the allowlist
    Given a due pending queued job named "future.job"
    When the Engine Takes with limit 1 and names ["sessions.gc"]
    Then no TakeResult leases "future.job"
    And "future.job" remains pending for a process that registers it

  @take @allowlist
  Scenario: Take with an empty allowlist leases nothing for Perform
    Given a due pending queued job named "work"
    And a due job_schedules row named "sessions.gc"
    When the Engine Takes with limit 1 and names []
    Then no TakeResult leases work for Perform
    # Past not_after queued expiry is name-agnostic and may still return DeadOnTake

  @take @not_after
  Scenario: Take marks past not_after dead without Perform
    Given a pending queued job with not_after in the past
    When the Engine Takes with limit 1 and names including that job's name
    Then the TakeResult has DeadOnTake true
    And the job status is "dead"
    And completed_at is set
    And no handler Perform is required for that result

  @take
  Scenario: Take ignores done and dead queued rows
    Given only terminal queued jobs exist for name "work"
    When the Engine Takes with limit 1 and names ["work"]
    Then no TakeResults are returned

  @take @batch
  Scenario: Take respects limit
    Given 3 pending due queued jobs with distinct ids and the same registered name
    When the Engine Takes with limit 1 and names for that job
    Then exactly 1 TakeResult is returned
    And the other jobs remain pending

  # --- Heartbeat / Complete / Fail + fencing ---

  @heartbeat
  Scenario: Heartbeat extends lease_until when the token matches
    Given a leased queued job held by this worker with token "T1"
    When I Heartbeat with id and token "T1" for "30s"
    Then lease_until is extended on the database clock
    And the job remains status "leased"

  @fencing
  Scenario: Heartbeat with a wrong token does not extend the lease
    Given a leased queued job with token "T1"
    When I Heartbeat with token "OLD"
    Then the lease columns are unchanged
    And the call is a no-op with no error

  @complete @periodic
  Scenario: Periodic Complete only advances run_at
    Given a leased job_schedules row "sessions.gc" with period "1m" and token "T1"
    When I Complete with token "T1"
    Then no additional schedule or job row was inserted for this beat
    And run_at is approximately now plus "1m"
    And lease columns are cleared
    And attempt is reset to 0
    And last_error is cleared

  @fail @periodic
  Scenario: Fail on a periodic schedule never marks dead and advances run_at
    Given a leased job_schedules row "sessions.gc" with period "1m" and token "T1"
    When I Fail with token "T1" and cause "boom"
    Then the schedule row still exists
    And run_at equals approximately now plus "1m"
    And lease columns are cleared
    And last_error is recorded
    And attempt is incremented
    # Unlike Complete, Fail does not reset attempt or clear last_error

  @complete @queued
  Scenario: Complete on a queued job marks done
    Given a leased queued job with token "T1"
    When I Complete with token "T1"
    Then the job status is "done"
    And completed_at is set
    And the live unique constraint no longer applies for that unique_key if present
    # Spanner NULLs active_unique_key; PG/SQLite keep the column and drop the row from the partial unique index via terminal status

  @fail @queued
  Scenario: Fail on a queued job schedules retry with backoff
    Given a leased queued job with attempt 0, max_attempts 5, and token "T1"
    When I Fail with token "T1" and backoff "10s"
    Then the job status is "pending"
    And attempt is 1
    And run_at is approximately now plus "10s"
    And last_error is recorded

  @fail @queued
  Scenario: Fail exhausts max_attempts and marks dead
    Given a leased queued job with attempt 4, max_attempts 5, and token "T1"
    When I Fail with token "T1" and backoff "10s"
    Then the job status is "dead"
    And completed_at is set
    And the live unique constraint no longer applies for that unique_key if present

  @fencing
  Scenario: Complete with a stale token after reclaim is a no-op
    Given queued job "work" was leased with token "OLD"
    And another Take reclaimed it with token "NEW"
    When I Complete with token "OLD"
    Then the job remains leased under token "NEW"
    And status is not "done"

  # --- DeleteCompleted (statement API; jobs.gc sweeper is @post-mvp Slice 5) ---

  @gc
  Scenario: DeleteCompleted removes old terminal queued rows only
    Given a done queued job completed before the retain cutoff
    And a dead queued job completed before the retain cutoff
    And a pending queued job
    And a leased queued job
    When I DeleteCompleted with completedBefore equal to the retain cutoff
    Then the old done and dead rows are deleted
    And the pending and leased rows remain
    And job_schedules rows are unaffected

  # --- Passivity ---

  @invariants
  Scenario: Statement methods do not open pool.Transaction themselves
    Given instrumentation that detects nested pool.Transaction from statements
    When I exercise Enqueue, SetPeriodic, Take, Heartbeat, Complete, Fail, and DeleteCompleted
    Then no statement method called pool.Transaction
