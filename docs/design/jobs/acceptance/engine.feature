# Shared jobs.Engine — RegisterWorker, Start/Close, RunDueOnce / drain.
# Dialects do NOT RegisterWorker. Automate with @engine tests (fake JobStatements or sqlite).

@engine @slice2
Feature: jobs.Engine loop and wake modes
  As a self-hosted or serverless deployment
  I need one Engine that Takes, Performs, and Completes or Fails
  So that the same JobStatements work under poll and under Cron drain

  Background:
    Given an Engine backed by JobStatements
    And default jobs config with concurrency 1, take_batch_size 1, lease_duration "30s", and heartbeat_interval "10s"

  # --- Registration ---

  Scenario: RegisterWorker binds a handler without touching storage
    When I RegisterWorker for job name "sessions.gc" with a no-op handler
    Then the Engine has a handler for "sessions.gc"
    And no JobStatements method was invoked by RegisterWorker

  Scenario: SetPeriodic is separate from RegisterWorker
    Given I RegisterWorker for "sessions.gc"
    When boot calls SetPeriodic for "sessions.gc" with period "1m"
    Then a job_schedules row for "sessions.gc" exists in storage
    And the Engine package did not call SetPeriodic itself

  # --- Happy path iteration ---

  Scenario: RunDueOnce Takes a due queued job, Performs, and Completes
    Given a registered handler for "probe.ok" that succeeds
    And a due pending queued job named "probe.ok"
    When I call RunDueOnce with budget 1
    Then the handler was invoked once
    And the job was Completed with the Take lease_token
    And ran count is 1

  Scenario: RunDueOnce Takes a due schedule, Performs, and Completes
    Given a registered handler for "sessions.gc" that succeeds
    And a due job_schedules row named "sessions.gc"
    When I call RunDueOnce with budget 1
    Then the handler was invoked once
    And Complete advanced the schedule run_at by its period
    And ran count is 1

  Scenario: Handler error causes Fail and reschedule
    Given a registered handler for "probe.fail" that returns an error
    And a due pending queued job named "probe.fail" with max_attempts 5
    When I call RunDueOnce with budget 1
    Then Fail was called with the Take lease_token
    And the job is pending with a future run_at

  # --- Heartbeat during Perform ---

  Scenario: Engine heartbeats while Perform runs
    Given a registered handler for "probe.slow" that runs longer than the heartbeat interval
    And a due pending queued job named "probe.slow"
    And heartbeat_interval is short for the test
    When I call RunDueOnce with budget 1
    Then Heartbeat was invoked at least once with the Take lease_token before Complete

  # --- Unknown name / DeadOnTake ---

  Scenario: Unknown job name is left alone and does not burn retries
    Given no handler registered for "future.job"
    And a due pending queued job named "future.job" with attempt 0
    When I call RunDueOnce with budget 1
    Then Take used an allowlist that excludes "future.job"
    And the handler was not invoked
    And the job was not Failed
    And the job remains available for a process that registers that name

  Scenario: Empty registered map Takes nothing for Perform
    Given no handlers are registered
    And a due pending queued job named "work"
    When I call RunDueOnce with budget 1
    Then Take was called with an empty names allowlist or skipped
    And the handler was not invoked
    And the job remains pending

  Scenario: DeadOnTake results skip Perform
    Given a TakeResult with DeadOnTake true for a past not_after queued job
    When the Engine processes that result
    Then Perform is not called
    And Completes or Fails are not called for a new lease on that path

  # --- Budget / shutdown ---

  Scenario: RunDueOnce stops Taking when budget is exhausted
    Given 5 due pending queued jobs named "probe.ok" with a succeeding handler
    When I call RunDueOnce with budget 2
    Then the handler was invoked 2 times
    And 3 queued jobs remain pending due

  Scenario: RunDueOnce stops when the context is cancelled
    Given a registered slow handler and many due jobs
    And a context that cancels after the first Perform starts
    When I call RunDueOnce with a large budget
    Then no new Take starts after cancellation
    And Close or drain ends without hanging

  Scenario: Start poll loop processes due work then Close stops it
    Given a registered handler for "probe.ok"
    And jobs.poll_interval is short for the test
    And jobs.trigger_secret is unset
    When I Start the Engine
    And a due queued job named "probe.ok" becomes available
    Then the job is Completed within a few poll intervals
    When I Close the Engine
    Then the poll loop has stopped
    And in-flight Perform is awaited or cancelled per Close contract

  # --- Wake equivalence ---

  Scenario: Self-hosted Start and serverless RunDueOnce share JobStatements
    Given the same storage fixture with one due job and one registered handler
    When process A would Start and process B would RunDueOnce
    Then both paths call Take, Perform, and Complete or Fail on JobStatements
    And neither path uses a separate nudge-only API

  # --- Defaults ---

  Scenario: Default concurrency is one Take-Perform loop per process
    Given jobs.concurrency is 1
    When the Engine is running
    Then at most one Perform for distinct Takes runs concurrently in this process
    # @deferred: raising concurrency on postgres/spanner is allowed later; sqlite effective max remains 1

  Scenario: Default lease and heartbeat match ADR 065
    Given jobs.Config from DefaultConfig
    Then lease_duration is "30s"
    And heartbeat_interval is "10s"
