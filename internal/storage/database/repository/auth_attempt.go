package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	googspanner "cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

// isSpannerClient returns true when the executor is backed by the Spanner dialect.
// Uses spanner.SpannerPooler (exported interface) to avoid unexported-method scoping issues.
func isSpannerClient(client database.QueryExecutor) bool {
	_, ok := client.(spanner.SpannerPooler)
	return ok
}

type AuthAttempt struct{}

var _ domain.AuthAttemptRepository = (*AuthAttempt)(nil)

// ── table name helpers ────────────────────────────────────────────────────────

func (a *AuthAttempt) tableAA(client database.QueryExecutor) string {
	if isSpannerClient(client) {
		return "auth_attempts"
	}
	return "zitadel_nextgen.auth_attempts"
}

func (a *AuthAttempt) tableAC(client database.QueryExecutor) string {
	if isSpannerClient(client) {
		return "auth_attempt_checks"
	}
	return "zitadel_nextgen.auth_attempt_checks"
}

func (a *AuthAttempt) now(client database.QueryExecutor) string {
	if isSpannerClient(client) {
		return "CURRENT_TIMESTAMP()"
	}
	return "NOW()"
}

// ── Get ───────────────────────────────────────────────────────────────────────

const authAttemptGetSelectPG = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
	` aa.required_checks, aa.created_at, aa.completed_at, aac.type, aa.time_to_live,` +
	` aac.last_challenged_at, aac.last_verified_at, aac.last_failed_at, aac.failure_count, aac.challenge_payload, aac.factor_payload` +
	` FROM zitadel_nextgen.auth_attempts aa` +
	` LEFT JOIN zitadel_nextgen.auth_attempt_checks aac ON aa.project_id = aac.project_id AND aa.id = aac.auth_attempt_id`

const authAttemptGetSelectSpanner = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
	` aa.required_checks, aa.created_at, aa.completed_at, aac.type, aa.time_to_live,` +
	` aac.last_challenged_at, aac.last_verified_at, aac.last_failed_at, aac.failure_count, aac.challenge_payload, aac.factor_payload` +
	` FROM auth_attempts aa` +
	` LEFT JOIN auth_attempt_checks aac ON aa.project_id = aac.project_id AND aa.id = aac.auth_attempt_id`

// GetByID implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) GetByID(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	if isSpannerClient(client) {
		return a.get(ctx, client, authAttemptGetSelectSpanner+` WHERE aa.project_id = $1 AND aa.id = $2`, projectID, authAttemptID)
	}
	return a.get(ctx, client, authAttemptGetSelectPG+` WHERE aa.project_id = $1 AND aa.id = $2`, projectID, authAttemptID)
}

// GetByHandoffToken implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) GetByHandoffToken(ctx context.Context, client database.QueryExecutor, projectID, handoffToken string) (*domain.AuthAttempt, error) {
	if isSpannerClient(client) {
		return a.get(ctx, client, authAttemptGetSelectSpanner+` WHERE aa.project_id = $1 AND aa.handoff_token = $2`, projectID, handoffToken)
	}
	return a.get(ctx, client, authAttemptGetSelectPG+` WHERE aa.project_id = $1 AND aa.handoff_token = $2`, projectID, handoffToken)
}

func (a *AuthAttempt) get(ctx context.Context, client database.QueryExecutor, query, projectID, matcher string) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := client.Query(ctx, query, projectID, matcher)
	if err != nil {
		return nil, fmt.Errorf("failed to query auth attempt: %w", err)
	}
	defer rows.Close()

	if isSpannerClient(client) {
		return attempt, a.scanSpanner(rows, attempt)
	}
	return attempt, a.scanPG(rows, attempt)
}

func (a *AuthAttempt) scanPG(rows database.Rows, attempt *domain.AuthAttempt) error {
	for rows.Next() {
		var (
			handoffToken     database.Null[string]
			handedOffAt      database.Null[time.Time]
			sessionID        database.Null[string]
			requiredChecks   []int16
			completedAt      database.Null[time.Time]
			checkType        database.Null[domain.AuthCheckType]
			timeToLive       *time.Duration
			lastChallengedAt database.Null[time.Time]
			verifiedAt       database.Null[time.Time]
			lastFailedAt     database.Null[time.Time]
			failureCount     database.Null[uint16]
			challenge        json.RawMessage
			factor           json.RawMessage
		)
		err := rows.Scan(
			&attempt.ProjectID, &attempt.ID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &completedAt, &checkType, &timeToLive,
			&lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor)
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
		if lastChallengedAt.Valid {
			check.LastChallengedAt = lastChallengedAt.V
		}
		if failureCount.Valid {
			check.FailureCount = failureCount.V
		}
		if verifiedAt.Valid {
			check.LastVerifiedAt = verifiedAt.V
		}
		if lastFailedAt.Valid {
			check.LastFailedAt = &lastFailedAt.V
		}
		checker, err := newAuthCheck(&check, challenge, factor)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		attempt.Checks = append(attempt.Checks, checker)
	}
	return rows.Err()
}

func (a *AuthAttempt) scanSpanner(rows database.Rows, attempt *domain.AuthAttempt) error {
	for rows.Next() {
		var (
			handoffToken     database.Null[string]
			handedOffAt      database.Null[time.Time]
			sessionID        database.Null[string]
			requiredChecks   []googspanner.NullInt64
			completedAt      database.Null[time.Time]
			checkType        database.Null[int64]
			timeToLiveNanos  database.Null[int64]
			lastChallengedAt database.Null[time.Time]
			verifiedAt       database.Null[time.Time]
			lastFailedAt     database.Null[time.Time]
			failureCount     database.Null[int64]
			challenge        jsonPayloadScanner
			factor           jsonPayloadScanner
		)
		err := rows.Scan(
			&attempt.ProjectID, &attempt.ID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &completedAt, &checkType, &timeToLiveNanos,
			&lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor)
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
		if lastChallengedAt.Valid {
			check.LastChallengedAt = lastChallengedAt.V
		}
		if failureCount.Valid {
			check.FailureCount = uint16(failureCount.V)
		}
		if verifiedAt.Valid {
			check.LastVerifiedAt = verifiedAt.V
		}
		if lastFailedAt.Valid {
			check.LastFailedAt = &lastFailedAt.V
		}
		checker, err := newAuthCheck(&check, challenge.v, factor.v)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		attempt.Checks = append(attempt.Checks, checker)
	}
	return rows.Err()
}

// jsonPayloadScanner handles JSONB (Postgres, returns []byte) and JSON
// (Spanner, returns spanner.NullJSON which implements json.Marshaler).
type jsonPayloadScanner struct {
	v json.RawMessage
}

func (s *jsonPayloadScanner) Scan(src any) error {
	if src == nil {
		s.v = nil
		return nil
	}
	switch v := src.(type) {
	case []byte:
		s.v = json.RawMessage(v)
	case string:
		s.v = json.RawMessage(v)
	default:
		if m, ok := src.(json.Marshaler); ok {
			data, err := m.MarshalJSON()
			if err != nil {
				return err
			}
			if string(data) == "null" {
				s.v = nil
				return nil
			}
			s.v = json.RawMessage(data)
		} else {
			return fmt.Errorf("jsonPayloadScanner: unsupported type %T", src)
		}
	}
	return nil
}

// ── Create ────────────────────────────────────────────────────────────────────

const authAttemptCreateStmt = `WITH inserted_attempt AS (` +
	` INSERT INTO zitadel_nextgen.auth_attempts (project_id, id, required_checks, time_to_live, session_id)` +
	` VALUES ($1, $2, $3::SMALLINT[], $4::INTERVAL, $5)` +
	` RETURNING project_id, id, created_at` +
	`), inserted_checks AS (` +
	` INSERT INTO zitadel_nextgen.auth_attempt_checks (project_id, auth_attempt_id, type, challenge_payload, factor_payload, last_challenged_at, last_verified_at)` +
	` SELECT ia.project_id, ia.id, checks.type, checks.challenge_payload, checks.factor_payload,` +
	` CASE WHEN checks.is_challenger THEN NOW() ELSE NULL END,` +
	` CASE WHEN checks.is_factorer AND NOT checks.is_challenger THEN NOW() ELSE NULL END` +
	` FROM inserted_attempt ia` +
	` JOIN LATERAL jsonb_to_recordset(COALESCE($6::JSONB, '[]'::JSONB)) AS checks(type SMALLINT, challenge_payload JSONB, factor_payload JSONB, is_challenger BOOLEAN, is_factorer BOOLEAN) ON TRUE` +
	` RETURNING type, last_challenged_at, last_verified_at` +
	`) SELECT ia.created_at, ic.type, ic.last_challenged_at, ic.last_verified_at` +
	` FROM inserted_attempt ia` +
	` LEFT JOIN inserted_checks ic ON TRUE`

// Create implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Create(ctx context.Context, client database.QueryExecutor, authAttempt *domain.AuthAttempt) error {
	if isSpannerClient(client) {
		return a.createSpanner(ctx, client, authAttempt)
	}

	checkRows := make([]authAttemptCheckCreate, 0, len(authAttempt.Checks))
	for _, checker := range authAttempt.Checks {
		check := checker.Check()
		checkRow := authAttemptCheckCreate{
			Type: uint8(check.Type),
		}
		if challenge, ok := checker.(domain.AuthChallenger); ok {
			checkRow.IsChallenger = true
			var err error
			checkRow.ChallengePayload, err = json.Marshal(challenge.ChallengePayload())
			if err != nil {
				return fmt.Errorf("failed to marshal challenge payload: %w", err)
			}
		}
		if factor, ok := checker.(domain.AuthFactorer); ok {
			checkRow.IsFactorer = true
			var err error
			checkRow.FactorPayload, err = json.Marshal(factor.FactorPayload())
			if err != nil {
				return fmt.Errorf("failed to marshal factor payload: %w", err)
			}
		}
		checkRows = append(checkRows, checkRow)
	}

	checkRowsJSON, err := json.Marshal(checkRows)
	if err != nil {
		return fmt.Errorf("failed to marshal auth attempt checks: %w", err)
	}

	// Convert required_checks to []int16 so pgx encodes it as SMALLINT[].
	requiredChecks := make([]int16, len(authAttempt.RequiredChecks))
	for i, c := range authAttempt.RequiredChecks {
		requiredChecks[i] = int16(c)
	}

	rows, err := client.Query(ctx, authAttemptCreateStmt,
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

func (a *AuthAttempt) createSpanner(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
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
		_, isChallenger := checker.(domain.AuthChallenger)
		_, isFactorer := checker.(domain.AuthFactorer)

		var challengedAt, verifiedAt *time.Time
		var challengePayload, factorPayload *string

		if isChallenger {
			t := now
			challengedAt = &t
			check.LastChallengedAt = now
			if ch, ok := checker.(domain.AuthChallenger); ok && ch.ChallengePayload() != nil {
				b, err := json.Marshal(ch.ChallengePayload())
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
			if f, ok := checker.(domain.AuthFactorer); ok && f.FactorPayload() != nil {
				b, err := json.Marshal(f.FactorPayload())
				if err != nil {
					return fmt.Errorf("failed to marshal factor payload: %w", err)
				}
				s := string(b)
				factorPayload = &s
			}
		}

		_, err = client.Exec(ctx,
			`INSERT INTO auth_attempt_checks (project_id, auth_attempt_id, type, last_challenged_at, last_verified_at, challenge_payload, factor_payload, failure_count) VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
			attempt.ProjectID, attempt.ID, int64(check.Type), challengedAt, verifiedAt, challengePayload, factorPayload)
		if err != nil {
			return fmt.Errorf("failed to create auth attempt check: %w", err)
		}
	}
	return nil
}

type authAttemptCheckCreate struct {
	Type             uint8           `json:"type"`
	ChallengePayload json.RawMessage `json:"challenge_payload,omitempty"`
	FactorPayload    json.RawMessage `json:"factor_payload,omitempty"`
	IsChallenger     bool            `json:"is_challenger"`
	IsFactorer       bool            `json:"is_factorer"`
}

// ── Delete ────────────────────────────────────────────────────────────────────

// Delete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Delete(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string) error {
	_, err := client.Exec(ctx,
		`DELETE FROM `+a.tableAA(client)+` WHERE project_id = $1 AND id = $2`,
		projectID, authAttemptID)
	return err
}

// ── Complete ──────────────────────────────────────────────────────────────────

// Complete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Complete(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	if isSpannerClient(client) {
		return a.completeSpanner(ctx, client, attempt)
	}
	return client.QueryRow(ctx,
		`UPDATE zitadel_nextgen.auth_attempts SET completed_at = NOW() WHERE project_id = $1 AND id = $2 RETURNING completed_at`,
		attempt.ProjectID, attempt.ID).Scan(&attempt.CompletedAt)
}

func (a *AuthAttempt) completeSpanner(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
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

// ── Handoff ───────────────────────────────────────────────────────────────────

// Handoff implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	if isSpannerClient(client) {
		return a.handoffSpanner(ctx, client, attempt)
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

func (a *AuthAttempt) handoffSpanner(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
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

// ── SetChallenge ──────────────────────────────────────────────────────────────

// SetChallenge implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) SetChallenge(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, challenger domain.AuthChallenger) (err error) {
	if isSpannerClient(client) {
		return a.setChallengeSpanner(ctx, client, projectID, authAttemptID, challenger)
	}
	var payload json.RawMessage
	if challenger.ChallengePayload() != nil {
		payload, err = json.Marshal(challenger.ChallengePayload())
		if err != nil {
			return fmt.Errorf("failed to marshal challenge payload: %w", err)
		}
	}
	return client.QueryRow(ctx,
		`INSERT INTO zitadel_nextgen.auth_attempt_checks`+
			` (project_id, auth_attempt_id, type, last_challenged_at, challenge_payload)`+
			` VALUES ($1, $2, $3, NOW(), $4::JSONB)`+
			` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET`+
			` last_challenged_at = NOW(), challenge_payload = EXCLUDED.challenge_payload, failure_count = 0, last_failed_at = NULL`+
			` RETURNING last_challenged_at`,
		projectID, authAttemptID, challenger.Check().Type, payload).
		Scan(&challenger.Check().LastChallengedAt)
}

func (a *AuthAttempt) setChallengeSpanner(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenger domain.AuthChallenger) (err error) {
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

	n, err := client.Exec(ctx,
		`UPDATE auth_attempt_checks SET last_challenged_at = $1, challenge_payload = $2, failure_count = 0, last_failed_at = NULL`+
			` WHERE project_id = $3 AND auth_attempt_id = $4 AND type = $5`,
		now, payloadStr, projectID, authAttemptID, int64(challenger.Check().Type))
	if err != nil {
		return fmt.Errorf("failed to set challenge: %w", err)
	}
	if n == 0 {
		_, err = client.Exec(ctx,
			`INSERT INTO auth_attempt_checks (project_id, auth_attempt_id, type, last_challenged_at, challenge_payload, failure_count) VALUES ($1, $2, $3, $4, $5, 0)`,
			projectID, authAttemptID, int64(challenger.Check().Type), now, payloadStr)
		if err != nil {
			return fmt.Errorf("failed to insert challenge: %w", err)
		}
	}
	challenger.Check().LastChallengedAt = now
	return nil
}

// ── ChallengeSucceeded ────────────────────────────────────────────────────────

// ChallengeSucceeded implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, check domain.AuthChecker) (err error) {
	if isSpannerClient(client) {
		return a.challengeSucceededSpanner(ctx, client, projectID, authAttemptID, check)
	}
	var factorPayload json.RawMessage
	if factorer, ok := check.(domain.AuthFactorer); ok && factorer.FactorPayload() != nil {
		factorPayload, err = json.Marshal(factorer.FactorPayload())
		if err != nil {
			return fmt.Errorf("failed to marshal factor payload: %w", err)
		}
	}
	return client.QueryRow(ctx,
		`INSERT INTO zitadel_nextgen.auth_attempt_checks`+
			` (project_id, auth_attempt_id, type, last_verified_at, factor_payload, challenge_payload)`+
			` VALUES ($1, $2, $3, NOW(), $4::JSONB, NULL)`+
			` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET`+
			` last_verified_at = NOW(), factor_payload = EXCLUDED.factor_payload, challenge_payload = NULL`+
			` RETURNING last_verified_at`,
		projectID, authAttemptID, check.Check().Type, factorPayload).
		Scan(&check.Check().LastVerifiedAt)
}

func (a *AuthAttempt) challengeSucceededSpanner(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, check domain.AuthChecker) (err error) {
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

	n, err := client.Exec(ctx,
		`UPDATE auth_attempt_checks SET last_verified_at = $1, factor_payload = $2, challenge_payload = NULL`+
			` WHERE project_id = $3 AND auth_attempt_id = $4 AND type = $5`,
		now, factorStr, projectID, authAttemptID, int64(check.Check().Type))
	if err != nil {
		return fmt.Errorf("failed to set challenge succeeded: %w", err)
	}
	if n == 0 {
		_, err = client.Exec(ctx,
			`INSERT INTO auth_attempt_checks (project_id, auth_attempt_id, type, last_verified_at, factor_payload, failure_count) VALUES ($1, $2, $3, $4, $5, 0)`,
			projectID, authAttemptID, int64(check.Check().Type), now, factorStr)
		if err != nil {
			return fmt.Errorf("failed to insert challenge succeeded: %w", err)
		}
	}
	check.Check().LastVerifiedAt = now
	return nil
}

// ── ChallengeFailed ───────────────────────────────────────────────────────────

// ChallengeFailed implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, challenger domain.AuthChecker) error {
	if isSpannerClient(client) {
		return a.challengeFailedSpanner(ctx, client, projectID, authAttemptID, challenger)
	}
	return client.QueryRow(ctx,
		`INSERT INTO zitadel_nextgen.auth_attempt_checks`+
			` (project_id, auth_attempt_id, type, last_failed_at, failure_count)`+
			` VALUES ($1, $2, $3, NOW(), 1)`+
			` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET`+
			` last_failed_at = NOW(), failure_count = zitadel_nextgen.auth_attempt_checks.failure_count + 1`+
			` RETURNING last_failed_at, failure_count`,
		projectID, authAttemptID, challenger.Check().Type).
		Scan(&challenger.Check().LastFailedAt, &challenger.Check().FailureCount)
}

func (a *AuthAttempt) challengeFailedSpanner(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenger domain.AuthChecker) error {
	now := time.Now().UTC()
	// Try UPDATE first (row exists).
	n, err := client.Exec(ctx,
		`UPDATE auth_attempt_checks SET last_failed_at = $1, failure_count = failure_count + 1`+
			` WHERE project_id = $2 AND auth_attempt_id = $3 AND type = $4`,
		now, projectID, authAttemptID, int64(challenger.Check().Type))
	if err != nil {
		return fmt.Errorf("failed to update challenge failed: %w", err)
	}
	if n == 0 {
		// Row does not exist — insert with count 1.
		_, err = client.Exec(ctx,
			`INSERT INTO auth_attempt_checks (project_id, auth_attempt_id, type, last_failed_at, failure_count) VALUES ($1, $2, $3, $4, 1)`,
			projectID, authAttemptID, int64(challenger.Check().Type), now)
		if err != nil {
			return fmt.Errorf("failed to insert challenge failed: %w", err)
		}
		challenger.Check().LastFailedAt = &now
		challenger.Check().FailureCount = 1
		return nil
	}

	// SELECT the current values so the caller sees the real counts.
	var failureCount int64
	var lastFailedAt time.Time
	err = client.QueryRow(ctx,
		`SELECT failure_count, last_failed_at FROM auth_attempt_checks WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3`,
		projectID, authAttemptID, int64(challenger.Check().Type)).
		Scan(&failureCount, &lastFailedAt)
	if err != nil {
		return fmt.Errorf("failed to read failure count: %w", err)
	}
	challenger.Check().FailureCount = uint16(failureCount)
	challenger.Check().LastFailedAt = &lastFailedAt
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

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
		return check, nil
	}
}
