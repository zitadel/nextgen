# First product consumer: sessions.gc / #881.
# Retention stays on RetentionJob — not covered here as a jobs handler yet.

@sessions-gc @slice3
Feature: sessions.gc periodic reaper
  As the platform
  I need expired sessions reaped in the background with a session.expired event
  So that Path B audit records expiry without relying only on read-time checks

  Background:
    Given the jobs Engine is wired for self-hosted Start or test RunDueOnce
    And a handler is RegisterWorker for "sessions.gc"
    And boot has SetPeriodic "sessions.gc" with a short test period
    And the Perform lives in service.SessionsGC.Perform(ctx) without importing internal/jobs
    And event retention still runs on its own RetentionJob ticker

  Scenario: Expired session is hard-deleted and session.expired is emitted
    Given a project with an exchanged session whose expires_at is in the past
    When the Engine runs due work for "sessions.gc"
    Then the session row is hard-deleted
    And associated tokens for that session are deleted
    And a Path B event "session.expired" exists for that session
    And the event actor type is system

  Scenario: Short TTL exchange can be verified locally without waiting a day
    Given session max_ttl allows a TTL of a few seconds in this test config
    When I exchange a session with that short TTL
    And I wait until expires_at is in the past on the database clock
    And I call RunDueOnce with sufficient budget
    Then the session is gone
    And "session.expired" was emitted once for that session id

  Scenario: Reaper is idempotent under at-least-once delivery
    Given an expired session that was already reaped
    When "sessions.gc" Runs again after a crash-before-Complete simulation or a second Take
    Then no error fails the job permanently
    And duplicate "session.expired" handling is safe
    And Completing the lease succeeds or a stale token no-ops cleanly

  Scenario: Live unexpired sessions are not deleted
    Given a session whose expires_at is in the future
    When "sessions.gc" Runs
    Then that session still exists
    And no "session.expired" event was emitted for it

  Scenario: Read-time expiry behavior is unchanged
    Given a session that is past expires_at but not yet reaped
    When a client reads or uses that session through existing APIs
    Then the session is treated as expired at read time as today
    And the reaper remains the Path B producer for "session.expired"

  Scenario: Only one sessions.gc lease runs cluster-wide for the schedule row
    Given two Engine processes sharing the same database
    And the "sessions.gc" job_schedules row is due
    When both processes Take around the same time
    Then at most one holds the live lease for "sessions.gc"
    And the other Takes zero rows or a different due job

  Scenario: Handler bounds work per Perform
    Given more expired sessions than the handler batch limit
    When "sessions.gc" Runs once
    Then at most the batch limit are processed in that Perform
    And remaining expired sessions are left for a later run
    # Parallelism is inside the sweeper batch, not via take_batch_size

  @mvp-coexistence
  Scenario: Retention is not cut over in this feature
    Given events older than the retention window exist
    When only the jobs Engine runs "sessions.gc"
    Then those old events are not deleted by "sessions.gc"
    And RetentionJob or its cron path remains responsible until a later cutover

  @post-mvp @slice6 @deferred
  Scenario: Retention cutover onto the jobs Engine
    # Not shipped in MVP. Slice 6: retire RetentionJob; events.retention becomes a
    # SetPeriodic / RegisterWorker consumer. Kept here so the acceptance suite
    # names the follow-up without pretending it landed.
    Given retention still runs on RetentionJob
    When Slice 6 lands
    Then events.retention is driven by jobs.Engine instead of RetentionJob
