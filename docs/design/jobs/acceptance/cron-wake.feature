# Serverless wake: Cron HTTP is the runner (drain), not a nudge-only signal.
# Same JobStatements as self-hosted Start(). Path: jobs.TriggerPath = "/cron/jobs".

@cron @slice4
Feature: Cron HTTP wake drains due jobs
  As the hosted cloud on a request-scoped process
  I need an authenticated Cron endpoint to RunDueOnce until budget or deadline
  So that periodic work like sessions.gc runs without a long-lived poll loop

  Background:
    Given jobs.trigger_secret is configured with at least 16 printable ASCII characters
    And the Engine has RegisterWorker for "sessions.gc"
    And SetPeriodic has registered "sessions.gc" on job_schedules
    And the jobs cron path is "/cron/jobs"
    And the long-lived Start poll loop is not running

  Scenario: Authorized Cron request drains due work
    Given a due "sessions.gc" schedule and an expired session fixture
    When I GET or POST "/cron/jobs" with bearer trigger secret
    Then the response is success with a ran count
    And drain looped RunDueOnce against JobStatements until empty or deadline
    And the expired session was reaped

  Scenario: Request without the secret is refused
    When I GET or POST "/cron/jobs" without a valid bearer secret
    Then the response is unauthorized
    And no Take was performed

  Scenario: Trigger secret too short is rejected at config validate
    Given a trigger secret shorter than 16 characters
    When the server validates jobs trigger config
    Then validation fails

  Scenario: Only GET and POST are accepted
    When I send PUT to "/cron/jobs" with a valid secret
    Then the response is method not allowed
    And no Take was performed

  Scenario: Drain stops at the request time budget
    Given many due jobs or schedules that would exceed the cloud function time budget
    When Cron invokes drain with a short deadline
    Then the handler returns before the deadline
    And remaining due work stays claimable for the next Cron tick

  Scenario: When trigger secret is set, Start poll is not used
    Given jobs.trigger_secret is set
    When the server boots in cloud mode
    Then the Engine does not Start a long-lived poll loop
    And Cron drain via "/cron/jobs" is the runner for due work

  Scenario: Self-hosted without trigger secret still uses Start
    Given jobs.trigger_secret is unset
    When the server boots self-hosted
    Then the Engine Start poll loop runs
    And "/cron/jobs" is not required for sessions.gc

  @mvp-coexistence
  Scenario: Events retention cron remains independent until cutover
    Given both "/cron/events-retention" and "/cron/jobs" exist
    When only "/cron/jobs" runs
    Then event retention purge is not implied
    And "/cron/events-retention" still authenticates with its own retention trigger path

  @post-mvp @slice5 @deferred
  Scenario: jobs.gc periodic cleaner calls DeleteCompleted
    # Not shipped in MVP. Slice 5: RegisterWorker + SetPeriodic for jobs.gc that
    # invokes DeleteCompleted on the retain window. DeleteCompleted itself is
    # already covered under @stmttest in job-statements.feature.
    Given terminal queued rows older than jobs.retain
    When Slice 5 lands and "jobs.gc" Runs
    Then DeleteCompleted removes those rows via the Engine

  @post-mvp @slice7 @deferred
  Scenario: Operator SetPeriodic via CLI or API
    # Not shipped in MVP. Slice 7: change period without restart. Boot/config
    # SetPeriodic in startJobsEngine remains the v1 path.
    Given the server is already running with "sessions.gc" scheduled
    When an operator SetPeriodic call updates the period
    Then the job_schedules period changes without a process restart
