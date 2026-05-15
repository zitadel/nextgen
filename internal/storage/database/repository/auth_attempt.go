package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	googspanner "cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

// NewAuthAttemptRepository returns a dialect-specific implementation of [domain.AuthAttemptRepository].
func NewAuthAttemptRepository(pool database.QueryExecutor) domain.AuthAttemptRepository {
	switch pool.(type) {
	case spanner.SpannerPooler:
		return &spannerAuthAttempt{}
	case postgres.PostgresPooler:
		return &pgAuthAttempt{}
	}
	panic("NewAuthAttemptRepository: unsupported pool type")
}

// ── Postgres implementation ───────────────────────────────────────────────────

type pgAuthAttempt struct{}

var _ domain.AuthAttemptRepository = (*pgAuthAttempt)(nil)

const pgAuthAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
	` aa.required_checks, aa.created_at, aa.completed_at, c.type, aa.time_to_live,` +
	` c.started_at, c.succeeded_at, c.failed_at, c.failure_count, c.challenge, c.factor, c.id` +
	` FROM zitadel_nextgen.auth_attempts aa` +
	` LEFT JOIN zitadel_nextgen.checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`

const authAttemptGetByIDStmt = pgAuthAttemptGetSelect +
	` WHERE aa.project_id = $1 AND aa.id = $2`

const authAttemptGetByHandoffTokenStmt = pgAuthAttemptGetSelect +
	` WHERE aa.project_id = $1 AND aa.handoff_token = $2`

func (a *pgAuthAttempt) GetByID(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, authAttemptGetByIDStmt, projectID, authAttemptID)
}

func (a *pgAuthAttempt) GetByHandoffToken(ctx context.Context, client database.QueryExecutor, projectID, handoffToken string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, authAttemptGetByHandoffTokenStmt, projectID, handoffToken)
}

func (a *pgAuthAttempt) get(ctx context.Context, client database.QueryExecutor, query, projectID, matcher string) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := client.Query(ctx, query, projectID, matcher)
	if err != nil {
		return nil, fmt.Errorf("failed to query auth attempt: %w", err)
	}
	defer rows.Close()
	return attempt, a.scan(rows, attempt)
}

func (a *pgAuthAttempt) scan(rows database.Rows, attempt *domain.AuthAttempt) error {
	for rows.Next() {
		var (
			handoffToken  database.Null[string]
			handedOffAt   database.Null[time.Time]
			sessionID     database.Null[string]
			requiredChecks []int16
			completedAt   database.Null[time.Time]
			checkType     database.Null[domain.AuthCheckType]
			timeToLive    *time.Duration
			startedAt     database.Null[time.Time]
			succeededAt   database.Null[time.Time]
			failedAt      database.Null[time.Time]
			failureCount  database.Null[uint16]
			challenge     json.RawMessage
			factor        json.RawMessage
			checkID       database.Null[string]
		)
		err := rows.Scan(
			&attempt.ProjectID, &attempt.ID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &completedAt, &checkType, &timeToLive,
			&startedAt, &succeededAt, &failedAt, &failureCount, &challenge, &factor, &checkID)
		if err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}

		attempt.RequiredChecks = make([]domain.AuthCheckType, len(requiredChecks))
		for i, c := range requiredChecks {
			attempt.RequiredChecks[i] = domain.AuthCheckType(c)
		}
		if handoffToken.Valid {
			attempt.HandoffToken = &handoffToken.V
		}
		if handedOffAt.Valid {
			attempt.HandedOffAt = &handedOffAt.V
		}
		if sessionID.Valid {
			attempt.SessionID = &sessionID.V
		}
		if completedAt.Valid {
			attempt.CompletedAt = &completedAt.V
		}
		attempt.TimeToLive = timeToLive

		if !checkType.Valid {
			continue
		}
		check := domain.AuthCheck{Type: checkType.V}
		if checkID.Valid {
			check.ID = checkID.V
		}
		if startedAt.Valid {
			check.LastChallengedAt = startedAt.V
		}
		if failureCount.Valid {
			check.FailureCount = failureCount.V
		}
		if succeededAt.Valid {
			check.LastVerifiedAt = succeededAt.V
		}
		if failedAt.Valid {
			check.LastFailedAt = &failedAt.V
		}
		checker, err := newAuthCheck(&check, challenge, factor)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		attempt.Checks = append(attempt.Checks, checker)
	}
	return rows.Err()
}

const pgAuthAttemptCreateStmt = `WITH inserted_attempt AS (` +
	` INSERT INTO zitadel_nextgen.auth_attempts (project_id, id, required_checks, time_to_live, session_id)` +
	` VALUES ($1, $2, $3::SMALLINT[], $4::INTERVAL, $5)` +
	` RETURNING project_id, id, created_at` +
	`), inserted_checks AS (` +
	` INSERT INTO zitadel_nextgen.checks (project_id, id, auth_attempt_id, type, challenge, factor, started_at, succeeded_at, failure_count)` +
	` SELECT ia.project_id, ia.project_id || ':' || ia.id || ':' || checks.type::TEXT, ia.id, checks.type, checks.challenge_payload, checks.factor_payload,` +
	` CASE WHEN checks.is_challenger THEN NOW() ELSE NULL END,` +
	` CASE WHEN checks.is_factorer AND NOT checks.is_challenger THEN NOW() ELSE NULL END, 0` +
	` FROM inserted_attempt ia` +
	` JOIN LATERAL jsonb_to_recordset(COALESCE($6::JSONB, '[]'::JSONB)) AS checks(type SMALLINT, challenge_payload JSONB, factor_payload JSONB, is_challenger BOOLEAN, is_factorer BOOLEAN) ON TRUE` +
	` RETURNING type, started_at, succeeded_at` +
	`) SELECT ia.created_at, ic.type, ic.started_at, ic.succeeded_at` +
	` FROM inserted_attempt ia` +
	` LEFT JOIN inserted_checks ic ON TRUE`

func (a *pgAuthAttempt) Create(ctx context.Context, client database.QueryExecutor, authAttempt *domain.AuthAttempt) error {
	checkRowsJSON, err := a.checksToJSON(authAttempt.Checks)
	if err != nil {
		return err
	}

	requiredChecks := make([]int16, len(authAttempt.RequiredChecks))
	for i, c := range authAttempt.RequiredChecks {
		requiredChecks[i] = int16(c)
	}

	rows, err := client.Query(ctx, pgAuthAttemptCreateStmt,
		authAttempt.ProjectID, authAttempt.ID, requiredChecks, authAttempt.TimeToLive, authAttempt.SessionID, checkRowsJSON)
	if err != nil {
		return fmt.Errorf("failed to create auth attempt: %w", err)
	}
	defer rows.Close()

	lastChallengedAtByType := make(map[domain.AuthCheckType]time.Time, len(authAttempt.Checks))
	lastVerifiedAtByType := make(map[domain.AuthCheckType]time.Time, len(authAttempt.Checks))
	for rows.Next() {
		var (
			createdAt        time.Time
			checkType        database.Null[uint8]
			lastChallengedAt database.Null[time.Time]
			lastVerifiedAt   database.Null[time.Time]
		)
		err = rows.Scan(&createdAt, &checkType, &lastChallengedAt, &lastVerifiedAt)
		if err != nil {
			return fmt.Errorf("failed to scan created auth attempt: %w", err)
		}
		authAttempt.CreatedAt = createdAt
		if checkType.Valid {
			checkTypeV := domain.AuthCheckType(checkType.V)
			if lastChallengedAt.Valid {
				lastChallengedAtByType[checkTypeV] = lastChallengedAt.V
			}
			if lastVerifiedAt.Valid {
				lastVerifiedAtByType[checkTypeV] = lastVerifiedAt.V
			}
		}
	}
	if err = rows.Err(); err != nil {
		return fmt.Errorf("failed to read created auth attempt rows: %w", err)
	}
	if authAttempt.CreatedAt.IsZero() {
		return fmt.Errorf("failed to create auth attempt: no rows returned")
	}

	for _, checker := range authAttempt.Checks {
		check := checker.Check()
		if t, ok := lastChallengedAtByType[check.Type]; ok {
			check.LastChallengedAt = t
		}
		if t, ok := lastVerifiedAtByType[check.Type]; ok {
			check.LastVerifiedAt = t
		}
	}
	return nil
}

func (*pgAuthAttempt) checksToJSON(checks []domain.AuthChecker) ([]byte, error) {
	checkRows := make([]authAttemptCheckCreate, 0, len(checks))
	for _, checker := range checks {
		check := checker.Check()
		checkRow := authAttemptCheckCreate{Type: uint8(check.Type)}
		if challenge, ok := checker.(domain.AuthChallenger); ok {
			checkRow.IsChallenger = true
			var err error
			checkRow.ChallengePayload, err = json.Marshal(challenge.ChallengePayload())
			if err != nil {
				return nil, fmt.Errorf("failed to marshal challenge payload: %w", err)
			}
		}
		if factor, ok := checker.(domain.AuthFactorer); ok {
			checkRow.IsFactorer = true
			var err error
			checkRow.FactorPayload, err = json.Marshal(factor.FactorPayload())
			if err != nil {
				return nil, fmt.Errorf("failed to marshal factor payload: %w", err)
			}
		}
		checkRows = append(checkRows, checkRow)
	}

	checkRowsJSON, err := json.Marshal(checkRows)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal auth attempt checks: %w", err)
	}
	return checkRowsJSON, nil
}

func (a *pgAuthAttempt) Delete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error {
	_, err := client.Exec(ctx,
		`DELETE FROM zitadel_nextgen.auth_attempts WHERE project_id = $1 AND id = $2`,
		projectID, authAttemptID)
	return err
}

func (a *pgAuthAttempt) Complete(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	return client.QueryRow(ctx,
		`UPDATE zitadel_nextgen.auth_attempts SET completed_at = NOW() WHERE project_id = $1 AND id = $2 RETURNING completed_at`,
		attempt.ProjectID, attempt.ID).Scan(&attempt.CompletedAt)
}

func (a *pgAuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	var handedOffAt time.Time
	err := client.QueryRow(ctx,
		`UPDATE zitadel_nextgen.auth_attempts SET handoff_token = $3, handed_off_at = NOW() WHERE project_id = $1 AND id = $2 RETURNING handed_off_at`,
		attempt.ProjectID, attempt.ID, *attempt.HandoffToken).Scan(&handedOffAt)
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", err)
	}
	attempt.HandedOffAt = &handedOffAt
	return nil
}

func (a *pgAuthAttempt) SetChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenger domain.AuthChallenger) (err error) {
	var payload json.RawMessage
	if challenger.ChallengePayload() != nil {
		payload, err = json.Marshal(challenger.ChallengePayload())
		if err != nil {
			return fmt.Errorf("failed to marshal challenge payload: %w", err)
		}
	}
	checkID := checkRowID(projectID, authAttemptID, challenger.Check().Type)
	return client.QueryRow(ctx,
		`INSERT INTO zitadel_nextgen.checks`+
			` (project_id, id, auth_attempt_id, type, started_at, challenge, failure_count)`+
			` VALUES ($1, $2, $3, $4, NOW(), $5::JSONB, 0)`+
			` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET`+
			` started_at = NOW(), challenge = EXCLUDED.challenge, failure_count = 0, failed_at = NULL`+
			` RETURNING started_at`,
		projectID, checkID, authAttemptID, challenger.Check().Type, payload).
		Scan(&challenger.Check().LastChallengedAt)
}

func (a *pgAuthAttempt) ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, check domain.AuthChecker) (err error) {
	var factorPayload json.RawMessage
	if factorer, ok := check.(domain.AuthFactorer); ok && factorer.FactorPayload() != nil {
		factorPayload, err = json.Marshal(factorer.FactorPayload())
		if err != nil {
			return fmt.Errorf("failed to marshal factor payload: %w", err)
		}
	}
	checkID := checkRowID(projectID, authAttemptID, check.Check().Type)
	if check.Check().ID != "" {
		checkID = check.Check().ID
	}
	return client.QueryRow(ctx,
		`INSERT INTO zitadel_nextgen.checks`+
			` (project_id, id, auth_attempt_id, type, succeeded_at, factor, challenge, failure_count)`+
			` VALUES ($1, $2, $3, $4, NOW(), $5::JSONB, NULL, 0)`+
			` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET`+
			` succeeded_at = NOW(), factor = EXCLUDED.factor, challenge = NULL`+
			` RETURNING succeeded_at`,
		projectID, checkID, authAttemptID, check.Check().Type, factorPayload).
		Scan(&check.Check().LastVerifiedAt)
}

func (a *pgAuthAttempt) ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenger domain.AuthChecker) error {
	checkID := checkRowID(projectID, authAttemptID, challenger.Check().Type)
	return client.QueryRow(ctx,
		`INSERT INTO zitadel_nextgen.checks`+
			` (project_id, id, auth_attempt_id, type, failed_at, failure_count)`+
			` VALUES ($1, $2, $3, $4, NOW(), 1)`+
			` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET`+
			` failed_at = NOW(), failure_count = zitadel_nextgen.checks.failure_count + 1`+
			` RETURNING failed_at, failure_count`,
		projectID, checkID, authAttemptID, challenger.Check().Type).
		Scan(&challenger.Check().LastFailedAt, &challenger.Check().FailureCount)
}

// ── Spanner implementation ────────────────────────────────────────────────────

type spannerAuthAttempt struct{}

var _ domain.AuthAttemptRepository = (*spannerAuthAttempt)(nil)

const spannerAuthAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
	` aa.required_checks, aa.created_at, aa.completed_at, c.type, aa.time_to_live,` +
	` c.started_at, c.succeeded_at, c.failed_at, c.failure_count, c.challenge, c.factor, c.id` +
	` FROM auth_attempts aa` +
	` LEFT JOIN checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`

func (a *spannerAuthAttempt) GetByID(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, spannerAuthAttemptGetSelect+` WHERE aa.project_id = $1 AND aa.id = $2`, projectID, authAttemptID)
}

func (a *spannerAuthAttempt) GetByHandoffToken(ctx context.Context, client database.QueryExecutor, projectID, handoffToken string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, spannerAuthAttemptGetSelect+` WHERE aa.project_id = $1 AND aa.handoff_token = $2`, projectID, handoffToken)
}

func (a *spannerAuthAttempt) get(ctx context.Context, client database.QueryExecutor, query, projectID, matcher string) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := client.Query(ctx, query, projectID, matcher)
	if err != nil {
		return nil, fmt.Errorf("failed to query auth attempt: %w", err)
	}
	defer rows.Close()
	return attempt, a.scan(rows, attempt)
}

func (a *spannerAuthAttempt) scan(rows database.Rows, attempt *domain.AuthAttempt) error {
	for rows.Next() {
		var (
			handoffToken    database.Null[string]
			handedOffAt     database.Null[time.Time]
			sessionID       database.Null[string]
			requiredChecks  []googspanner.NullInt64
			completedAt     database.Null[time.Time]
			checkType       database.Null[int64]
			timeToLiveNanos database.Null[int64]
			startedAt       database.Null[time.Time]
			succeededAt     database.Null[time.Time]
			failedAt        database.Null[time.Time]
			failureCount    database.Null[int64]
			challenge       JSON[json.RawMessage]
			factor          JSON[json.RawMessage]
			checkID         database.Null[string]
		)
		err := rows.Scan(
			&attempt.ProjectID, &attempt.ID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &completedAt, &checkType, &timeToLiveNanos,
			&startedAt, &succeededAt, &failedAt, &failureCount, &challenge, &factor, &checkID)
		if err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}

		attempt.RequiredChecks = make([]domain.AuthCheckType, len(requiredChecks))
		for i, c := range requiredChecks {
			attempt.RequiredChecks[i] = domain.AuthCheckType(c.Int64)
		}
		if handoffToken.Valid {
			attempt.HandoffToken = &handoffToken.V
		}
		if handedOffAt.Valid {
			attempt.HandedOffAt = &handedOffAt.V
		}
		if sessionID.Valid {
			attempt.SessionID = &sessionID.V
		}
		if completedAt.Valid {
			attempt.CompletedAt = &completedAt.V
		}
		if timeToLiveNanos.Valid {
			d := time.Duration(timeToLiveNanos.V)
			attempt.TimeToLive = &d
		}

		if !checkType.Valid {
			continue
		}
		check := domain.AuthCheck{Type: domain.AuthCheckType(checkType.V)}
		if checkID.Valid {
			check.ID = checkID.V
		}
		if startedAt.Valid {
			check.LastChallengedAt = startedAt.V
		}
		if failureCount.Valid {
			check.FailureCount = uint16(failureCount.V)
		}
		if succeededAt.Valid {
			check.LastVerifiedAt = succeededAt.V
		}
		if failedAt.Valid {
			check.LastFailedAt = &failedAt.V
		}
		checker, err := newAuthCheck(&check, challenge.Value, factor.Value)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		attempt.Checks = append(attempt.Checks, checker)
	}
	return rows.Err()
}

func (a *spannerAuthAttempt) Create(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	now := time.Now().UTC()
	attempt.CreatedAt = now

	req := make([]int64, len(attempt.RequiredChecks))
	for i, c := range attempt.RequiredChecks {
		req[i] = int64(c)
	}
	var ttlNanos *int64
	if attempt.TimeToLive != nil {
		n := attempt.TimeToLive.Nanoseconds()
		ttlNanos = &n
	}

	_, err := client.Exec(ctx,
		`INSERT INTO auth_attempts (project_id, id, required_checks, time_to_live, session_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		attempt.ProjectID, attempt.ID, req, ttlNanos, attempt.SessionID, now)
	if err != nil {
		return fmt.Errorf("failed to create auth attempt: %w", err)
	}

	for _, checker := range attempt.Checks {
		check := checker.Check()
		challenge, isChallenger := checker.(domain.AuthChallenger)
		factor, isFactorer := checker.(domain.AuthFactorer)

		var challengedAt, verifiedAt *time.Time
		var challengePayload, factorPayload *string

		if isChallenger {
			t := now
			challengedAt = &t
			check.LastChallengedAt = now
			if cp := challenge.ChallengePayload(); cp != nil {
				b, err := json.Marshal(cp)
				if err != nil {
					return fmt.Errorf("failed to marshal challenge payload: %w", err)
				}
				s := string(b)
				challengePayload = &s
			}
		}
		if isFactorer {
			if !isChallenger {
				t := now
				verifiedAt = &t
				check.LastVerifiedAt = now
			}
			if fp := factor.FactorPayload(); fp != nil {
				b, err := json.Marshal(fp)
				if err != nil {
					return fmt.Errorf("failed to marshal factor payload: %w", err)
				}
				s := string(b)
				factorPayload = &s
			}
		}

		cid := checkRowID(attempt.ProjectID, attempt.ID, check.Type)
		_, err = client.Exec(ctx,
			`INSERT INTO checks (project_id, id, auth_attempt_id, type, started_at, succeeded_at, challenge, factor, failure_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
			attempt.ProjectID, cid, attempt.ID, int64(check.Type), challengedAt, verifiedAt, challengePayload, factorPayload)
		if err != nil {
			return fmt.Errorf("failed to create auth attempt check: %w", err)
		}
	}
	return nil
}

func (a *spannerAuthAttempt) Delete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error {
	_, err := client.Exec(ctx,
		`DELETE FROM auth_attempts WHERE project_id = $1 AND id = $2`,
		projectID, authAttemptID)
	return err
}

func (a *spannerAuthAttempt) Complete(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	now := time.Now().UTC()
	n, err := client.Exec(ctx,
		`UPDATE auth_attempts SET completed_at = $1 WHERE project_id = $2 AND id = $3`,
		now, attempt.ProjectID, attempt.ID)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	attempt.CompletedAt = &now
	return nil
}

func (a *spannerAuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	now := time.Now().UTC()
	_, err := client.Exec(ctx,
		`UPDATE auth_attempts SET handoff_token = $1, handed_off_at = $2 WHERE project_id = $3 AND id = $4`,
		*attempt.HandoffToken, now, attempt.ProjectID, attempt.ID)
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", err)
	}
	attempt.HandedOffAt = &now
	return nil
}

func (a *spannerAuthAttempt) SetChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenger domain.AuthChallenger) (err error) {
	now := time.Now().UTC()
	var payloadStr *string
	if challenger.ChallengePayload() != nil {
		b, err := json.Marshal(challenger.ChallengePayload())
		if err != nil {
			return fmt.Errorf("failed to marshal challenge payload: %w", err)
		}
		s := string(b)
		payloadStr = &s
	}

	cid := checkRowID(projectID, authAttemptID, challenger.Check().Type)
	n, err := client.Exec(ctx,
		`UPDATE checks SET started_at = $1, challenge = $2, failure_count = 0, failed_at = NULL`+
			` WHERE project_id = $3 AND auth_attempt_id = $4 AND type = $5`,
		now, payloadStr, projectID, authAttemptID, int64(challenger.Check().Type))
	if err != nil {
		return fmt.Errorf("failed to set challenge: %w", err)
	}
	if n == 0 {
		_, err = client.Exec(ctx,
			`INSERT INTO checks (project_id, id, auth_attempt_id, type, started_at, challenge, failure_count) VALUES ($1, $2, $3, $4, $5, $6, 0)`,
			projectID, cid, authAttemptID, int64(challenger.Check().Type), now, payloadStr)
		if err != nil {
			return fmt.Errorf("failed to insert challenge: %w", err)
		}
	}
	challenger.Check().LastChallengedAt = now
	return nil
}

func (a *spannerAuthAttempt) ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, check domain.AuthChecker) (err error) {
	now := time.Now().UTC()
	var factorStr *string
	if factorer, ok := check.(domain.AuthFactorer); ok && factorer.FactorPayload() != nil {
		b, err := json.Marshal(factorer.FactorPayload())
		if err != nil {
			return fmt.Errorf("failed to marshal factor payload: %w", err)
		}
		s := string(b)
		factorStr = &s
	}

	cid := checkRowID(projectID, authAttemptID, check.Check().Type)
	n, err := client.Exec(ctx,
		`UPDATE checks SET succeeded_at = $1, factor = $2, challenge = NULL`+
			` WHERE project_id = $3 AND auth_attempt_id = $4 AND type = $5`,
		now, factorStr, projectID, authAttemptID, int64(check.Check().Type))
	if err != nil {
		return fmt.Errorf("failed to set challenge succeeded: %w", err)
	}
	if n == 0 {
		_, err = client.Exec(ctx,
			`INSERT INTO checks (project_id, id, auth_attempt_id, type, succeeded_at, factor, failure_count) VALUES ($1, $2, $3, $4, $5, $6, 0)`,
			projectID, cid, authAttemptID, int64(check.Check().Type), now, factorStr)
		if err != nil {
			return fmt.Errorf("failed to insert challenge succeeded: %w", err)
		}
	}
	check.Check().LastVerifiedAt = now
	return nil
}

func (a *spannerAuthAttempt) ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenger domain.AuthChecker) error {
	now := time.Now().UTC()
	cid := checkRowID(projectID, authAttemptID, challenger.Check().Type)
	n, err := client.Exec(ctx,
		`UPDATE checks SET failed_at = $1, failure_count = failure_count + 1`+
			` WHERE project_id = $2 AND auth_attempt_id = $3 AND type = $4`,
		now, projectID, authAttemptID, int64(challenger.Check().Type))
	if err != nil {
		return fmt.Errorf("failed to update challenge failed: %w", err)
	}
	if n == 0 {
		_, err = client.Exec(ctx,
			`INSERT INTO checks (project_id, id, auth_attempt_id, type, failed_at, failure_count) VALUES ($1, $2, $3, $4, $5, 1)`,
			projectID, cid, authAttemptID, int64(challenger.Check().Type), now)
		if err != nil {
			return fmt.Errorf("failed to insert challenge failed: %w", err)
		}
		challenger.Check().LastFailedAt = &now
		challenger.Check().FailureCount = 1
		return nil
	}

	var failureCount int64
	var lastFailedAt time.Time
	err = client.QueryRow(ctx,
		`SELECT failure_count, failed_at FROM checks WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3`,
		projectID, authAttemptID, int64(challenger.Check().Type)).
		Scan(&failureCount, &lastFailedAt)
	if err != nil {
		return fmt.Errorf("failed to read failure count: %w", err)
	}
	challenger.Check().FailureCount = uint16(failureCount)
	challenger.Check().LastFailedAt = &lastFailedAt
	return nil
}

// ── Shared helpers ────────────────────────────────────────────────────────────

func newAuthCheck(check *domain.AuthCheck, challenge, factor json.RawMessage) (_ domain.AuthChecker, err error) {
	switch check.Type {
	case domain.AuthCheckTypeUser:
		userCheck := &domain.UserAuthCheck{
			AuthCheck: check,
			Factor:    new(domain.UserFactor),
		}
		if len(factor) > 0 {
			err = json.Unmarshal(factor, userCheck.Factor)
			if err != nil {
				return nil, fmt.Errorf("failed to unmarshal user auth check factor payload: %w", err)
			}
		}
		return userCheck, nil
	case domain.AuthCheckTypePassword:
		return &domain.PasswordAuthCheck{
			AuthCheck: check,
		}, nil
	case domain.AuthCheckTypePasskey:
		passkeyCheck := &domain.PasskeyAuthCheck{
			AuthCheck: check,
			Challenge: new(domain.PasskeyAuthCheckChallenge),
			Factor:    new(domain.PasskeyAuthCheckFactor),
		}
		if len(challenge) > 0 {
			err = json.Unmarshal(challenge, passkeyCheck.Challenge)
			if err != nil {
				return nil, fmt.Errorf("failed to unmarshal passkey auth check challenge payload: %w", err)
			}
		}
		if len(factor) > 0 {
			err = json.Unmarshal(factor, passkeyCheck.Factor)
			if err != nil {
				return nil, fmt.Errorf("failed to unmarshal passkey auth check factor payload: %w", err)
			}
		}
		return passkeyCheck, nil
	case domain.AuthCheckTypeIdentityProvider:
		return &domain.IdentityProviderAuthCheck{
			AuthCheck: check,
		}, nil
	default:
		log.Println("unsupported auth check type:", check.Type)
		return check, nil
	}
}

type authAttemptCheckCreate struct {
	Type             uint8           `json:"type"`
	ChallengePayload json.RawMessage `json:"challenge_payload,omitempty"`
	FactorPayload    json.RawMessage `json:"factor_payload,omitempty"`
	IsChallenger     bool            `json:"is_challenger"`
	IsFactorer       bool            `json:"is_factorer"`
}
