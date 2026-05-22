package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	googspanner "cloud.google.com/go/spanner"
	"github.com/jackc/pgx/v5"
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
	` aa.required_checks, aa.created_at, c.type, aa.time_to_live,` +
	` c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
	` FROM zitadel_nextgen.auth_attempts aa` +
	` LEFT JOIN zitadel_nextgen.checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`

func (a *pgAuthAttempt) GetByID(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, pgAuthAttemptGetSelect+` WHERE aa.project_id = $1 AND aa.id = $2`, projectID, authAttemptID)
}

func (a *pgAuthAttempt) GetByHandoffToken(ctx context.Context, client database.QueryExecutor, projectID string, handoffToken []byte) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, pgAuthAttemptGetSelect+` WHERE aa.project_id = $1 AND aa.handoff_token = $2`, projectID, string(handoffToken))
}

func (a *pgAuthAttempt) get(ctx context.Context, client database.QueryExecutor, query, projectID, matcher string) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := client.Query(ctx, query, projectID, database.Identity(matcher))
	if err != nil {
		return nil, fmt.Errorf("failed to query auth attempt: %w", err)
	}
	defer rows.Close()
	return attempt, a.scan(rows, attempt)
}

func (a *pgAuthAttempt) scan(rows database.Rows, attempt *domain.AuthAttempt) error {
	var found bool
	for rows.Next() {
		found = true
		var (
			attemptID        database.Identity
			handoffToken     database.Null[[]byte]
			handedOffAt      database.Null[time.Time]
			sessionID        database.Null[int64]
			requiredChecks   []int16
			checkType        database.Null[domain.AuthCheckType]
			timeToLive       *time.Duration
			challengeID      database.Null[string]
			lastChallengedAt database.Null[time.Time]
			verifiedAt       database.Null[time.Time]
			lastFailedAt     database.Null[time.Time]
			failureCount     database.Null[uint16]
			challenge        json.RawMessage
			factor           json.RawMessage
		)
		err := rows.Scan(
			&attempt.ProjectID, &attemptID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &checkType, &timeToLive,
			&challengeID, &lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor)
		if err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		attempt.ID = attemptID.String()

		attempt.RequiredChecks = make([]domain.AuthCheckType, len(requiredChecks))
		for i, c := range requiredChecks {
			attempt.RequiredChecks[i] = domain.AuthCheckType(c)
		}
		if handoffToken.Valid {
			attempt.HandoffToken = &domain.HandoffToken{TokenHash: handoffToken.V}
		}
		if handedOffAt.Valid {
			attempt.HandedOffAt = &handedOffAt.V
		}
		if sessionID.Valid {
			s := strconv.FormatInt(sessionID.V, 10)
			attempt.SessionID = &s
		}
		attempt.TimeToLive = timeToLive

		if !checkType.Valid {
			continue
		}
		checks, err := newAuthChecks(checkType.V, challengeID.V, lastChallengedAt.V, lastFailedAt.V, verifiedAt.V, failureCount.V, challenge, factor)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		for _, checker := range checks {
			attempt.SetCheck(checker)
		}
	}
	if !found {
		return domain.ErrAuthAttemptNotFound()
	}
	return rows.Err()
}

const pgAuthAttemptCreateStmt = `WITH inserted_attempt AS (` +
	` INSERT INTO zitadel_nextgen.auth_attempts (project_id, required_checks, time_to_live, session_id)` +
	` VALUES ($1, $2::SMALLINT[], $3::INTERVAL, $4::BIGINT)` +
	` RETURNING project_id, id, created_at` +
	`), inserted_checks AS (` +
	` INSERT INTO zitadel_nextgen.checks (project_id, auth_attempt_id, type, challenge_payload, factor_payload, last_challenged_at, last_verified_at)` +
	` SELECT ia.project_id, ia.id, checks.type, checks.challenge_payload, checks.factor_payload,` +
	` CASE WHEN checks.is_challenge THEN NOW() ELSE NULL END,` +
	` CASE WHEN checks.is_factor AND NOT checks.is_challenge THEN NOW() ELSE NULL END` +
	` FROM inserted_attempt ia` +
	` JOIN LATERAL jsonb_to_recordset(COALESCE($5::JSONB, '[]'::JSONB)) AS checks(type SMALLINT, challenge_payload JSONB, factor_payload JSONB, is_challenge BOOLEAN, is_factor BOOLEAN) ON TRUE` +
	` RETURNING id, type, last_challenged_at, last_verified_at` +
	`) SELECT ia.id, ia.created_at, ic.id, ic.type, ic.last_challenged_at, ic.last_verified_at` +
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
		authAttempt.ProjectID, requiredChecks, authAttempt.TimeToLive, sessionIDArg(authAttempt.SessionID), checkRowsJSON)
	if err != nil {
		return fmt.Errorf("failed to create auth attempt: %w", err)
	}
	defer rows.Close()

	challengeIDByType := make(map[domain.AuthCheckType]database.Identity, len(authAttempt.Checks))
	lastChallengedAtByType := make(map[domain.AuthCheckType]time.Time, len(authAttempt.Checks))
	lastVerifiedAtByType := make(map[domain.AuthCheckType]time.Time, len(authAttempt.Checks))
	for rows.Next() {
		var (
			attemptID        database.Identity
			createdAt        time.Time
			challengeID      database.Identity
			checkType        database.Null[uint8]
			lastChallengedAt database.Null[time.Time]
			lastVerifiedAt   database.Null[time.Time]
		)
		err = rows.Scan(&attemptID, &createdAt, &challengeID, &checkType, &lastChallengedAt, &lastVerifiedAt)
		if err != nil {
			return fmt.Errorf("failed to scan created auth attempt: %w", err)
		}
		authAttempt.ID = attemptID.String()
		authAttempt.CreatedAt = createdAt
		if checkType.Valid {
			checkTypeV := domain.AuthCheckType(checkType.V)
			if challengeID.String() != "" {
				challengeIDByType[checkTypeV] = challengeID
			}
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
	if authAttempt.ID == "" || authAttempt.CreatedAt.IsZero() {
		return fmt.Errorf("failed to create auth attempt: no rows returned")
	}

	for _, check := range authAttempt.Checks {
		if t, ok := challengeIDByType[check.Type()]; ok {
			if challenge, ok := check.(domain.AuthChallenge); ok {
				challenge.SetID(t.String())
			}
		}
		if t, ok := lastChallengedAtByType[check.Type()]; ok {
			if challenge, ok := check.(domain.AuthChallenge); ok {
				challenge.SetLastChallengedAt(t)
			}
		}
		if t, ok := lastVerifiedAtByType[check.Type()]; ok {
			if factor, ok := check.(domain.AuthFactor); ok {
				factor.SetLastVerifiedAt(t)
			}
		}
	}
	return nil
}

func (*pgAuthAttempt) checksToJSON(checks []domain.AuthCheck) ([]byte, error) {
	checkRows := make([]authAttemptCheckCreate, 0, len(checks))
	for _, check := range checks {
		checkRow := authAttemptCheckCreate{Type: uint8(check.Type())}
		if challenge, ok := check.(domain.AuthChallenge); ok {
			checkRow.IsChallenge = true
			var err error
			checkRow.ChallengePayload, err = json.Marshal(challenge.Payload())
			if err != nil {
				return nil, fmt.Errorf("failed to marshal challenge payload: %w", err)
			}
		}
		if factor, ok := check.(domain.AuthFactor); ok {
			checkRow.IsFactor = true
			var err error
			checkRow.FactorPayload, err = json.Marshal(factor.Payload())
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
		projectID, database.Identity(authAttemptID))
	return err
}

func (a *pgAuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	var handedOffAt time.Time
	err := client.QueryRow(ctx,
		`UPDATE zitadel_nextgen.auth_attempts SET handoff_token = $3, handed_off_at = NOW() WHERE project_id = $1 AND id = $2 RETURNING handed_off_at`,
		attempt.ProjectID, database.Identity(attempt.ID), attempt.HandoffToken.TokenHash).Scan(&handedOffAt)
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", err)
	}
	attempt.HandedOffAt = &handedOffAt
	return nil
}

func (a *pgAuthAttempt) SetChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenge domain.AuthChallenge) (err error) {
	var payload json.RawMessage
	if challenge.Payload() != nil {
		payload, err = json.Marshal(challenge.Payload())
		if err != nil {
			return fmt.Errorf("failed to marshal challenge payload: %w", err)
		}
	}
	var id string
	var lastChallengedAt time.Time
	err = client.QueryRow(ctx,
		`INSERT INTO zitadel_nextgen.checks`+
			` (project_id, auth_attempt_id, type, last_challenged_at, challenge_payload)`+
			` VALUES ($1, $2, $3, NOW(), $4::JSONB)`+
			` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET`+
			` id = nextval(pg_get_serial_sequence('zitadel_nextgen.checks', 'id')),`+
			` last_challenged_at = NOW(), challenge_payload = EXCLUDED.challenge_payload, failure_count = 0, last_failed_at = NULL`+
			` RETURNING id, last_challenged_at`,
		projectID, database.Identity(authAttemptID), challenge.Type(), payload).
		Scan(&id, &lastChallengedAt)
	if err != nil {
		return err
	}
	challenge.SetID(id)
	challenge.SetLastChallengedAt(lastChallengedAt)
	challenge.SetFailureCount(0)
	challenge.SetLastFailedAt(time.Time{})
	return nil
}

func (a *pgAuthAttempt) ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, factor domain.AuthFactor, id string) (err error) {
	var factorPayload json.RawMessage
	if payload := factor.Payload(); payload != nil {
		factorPayload, err = json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal factor payload: %w", err)
		}
	}
	var lastVerifiedAt time.Time
	err = client.QueryRow(ctx,
		`UPDATE zitadel_nextgen.checks`+
			` SET last_verified_at = NOW(), factor_payload = $4::JSONB, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0`+
			` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3 AND id = $5`+
			` RETURNING last_verified_at`,
		projectID, database.Identity(authAttemptID), factor.Type(), factorPayload, id).
		Scan(&lastVerifiedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrAuthAttemptStaleChallenge()
		}
		return err
	}
	factor.SetLastVerifiedAt(lastVerifiedAt)
	return nil
}

func (a *pgAuthAttempt) ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenge domain.AuthChallenge) error {
	var lastFailedAt time.Time
	var failureCount uint16
	err := client.QueryRow(ctx,
		`UPDATE zitadel_nextgen.checks`+
			` SET last_failed_at = NOW(), failure_count = failure_count + 1`+
			` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3 AND id = $4`+
			` RETURNING last_failed_at, failure_count`,
		projectID, database.Identity(authAttemptID), challenge.Type(), challenge.GetID()).
		Scan(&lastFailedAt, &failureCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrAuthAttemptStaleChallenge()
		}
		return err
	}
	challenge.SetLastFailedAt(lastFailedAt)
	challenge.SetFailureCount(failureCount)
	return nil
}

// ── Spanner implementation ────────────────────────────────────────────────────

type spannerAuthAttempt struct{}

var _ domain.AuthAttemptRepository = (*spannerAuthAttempt)(nil)

const spannerAuthAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
	` aa.required_checks, aa.created_at, c.type, aa.time_to_live,` +
	` c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
	` FROM auth_attempts aa` +
	` LEFT JOIN checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`

func (a *spannerAuthAttempt) GetByID(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, spannerAuthAttemptGetSelect+` WHERE aa.project_id = $1 AND aa.id = $2`, projectID, database.Identity(authAttemptID))
}

func (a *spannerAuthAttempt) GetByHandoffToken(ctx context.Context, client database.QueryExecutor, projectID string, handoffToken []byte) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, spannerAuthAttemptGetSelect+` WHERE aa.project_id = $1 AND aa.handoff_token = $2`, projectID, handoffToken)
}

func (a *spannerAuthAttempt) get(ctx context.Context, client database.QueryExecutor, query, projectID string, matcher any) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := client.Query(ctx, query, projectID, matcher)
	if err != nil {
		return nil, fmt.Errorf("failed to query auth attempt: %w", err)
	}
	defer rows.Close()
	return attempt, a.scan(rows, attempt)
}

func (a *spannerAuthAttempt) scan(rows database.Rows, attempt *domain.AuthAttempt) error {
	var found bool
	for rows.Next() {
		found = true
		var (
			attemptID        database.Identity
			handoffToken     database.Null[[]byte]
			handedOffAt      database.Null[time.Time]
			sessionID        database.Null[int64]
			requiredChecks   []googspanner.NullInt64
			checkType        database.Null[int64]
			timeToLiveNanos  database.Null[int64]
			challengeID      database.Identity
			lastChallengedAt database.Null[time.Time]
			verifiedAt       database.Null[time.Time]
			lastFailedAt     database.Null[time.Time]
			failureCount     database.Null[int64]
			challenge        JSON[json.RawMessage]
			factor           JSON[json.RawMessage]
		)
		err := rows.Scan(
			&attempt.ProjectID, &attemptID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &checkType, &timeToLiveNanos,
			&challengeID, &lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor)
		if err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		attempt.ID = attemptID.String()

		attempt.RequiredChecks = make([]domain.AuthCheckType, len(requiredChecks))
		for i, c := range requiredChecks {
			attempt.RequiredChecks[i] = domain.AuthCheckType(c.Int64)
		}
		if handoffToken.Valid {
			attempt.HandoffToken = &domain.HandoffToken{TokenHash: handoffToken.V}
		}
		if handedOffAt.Valid {
			attempt.HandedOffAt = &handedOffAt.V
		}
		if sessionID.Valid {
			attempt.SessionID = new(strconv.FormatInt(sessionID.V, 10))
		}
		if timeToLiveNanos.Valid {
			attempt.TimeToLive = new(time.Duration(timeToLiveNanos.V))
		}

		if !checkType.Valid {
			continue
		}
		checks, err := newAuthChecks(domain.AuthCheckType(checkType.V), challengeID.String(), lastChallengedAt.V, lastFailedAt.V, verifiedAt.V, uint16(failureCount.V), challenge.Value, factor.Value)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		for _, checker := range checks {
			attempt.SetCheck(checker)
		}
	}
	if !found {
		return domain.ErrAuthAttemptNotFound()
	}
	return rows.Err()
}

func (a *spannerAuthAttempt) Create(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	now := time.Now().UTC()

	req := make([]int64, len(attempt.RequiredChecks))
	for i, c := range attempt.RequiredChecks {
		req[i] = int64(c)
	}
	var ttlNanos *int64
	if attempt.TimeToLive != nil {
		ttlNanos = new(attempt.TimeToLive.Nanoseconds())
	}

	var attemptID database.Identity
	err := client.QueryRow(ctx,
		`INSERT INTO auth_attempts (project_id, required_checks, time_to_live, session_id, created_at) VALUES ($1, $2, $3, $4, $5) THEN RETURN id`,
		attempt.ProjectID, req, ttlNanos, sessionIDArg(attempt.SessionID), now).
		Scan(&attemptID)
	if err != nil {
		return fmt.Errorf("failed to create auth attempt: %w", err)
	}
	attempt.ID = attemptID.String()
	attempt.CreatedAt = now

	for _, check := range attempt.Checks {
		challenge, isChallenge := check.(domain.AuthChallenge)
		factor, isFactor := check.(domain.AuthFactor)

		var challengedAt, verifiedAt *time.Time
		var challengePayload, factorPayload *string

		if isChallenge {
			challengedAt = new(now)
			challenge.SetLastChallengedAt(now)
			if cp := challenge.Payload(); cp != nil {
				b, err := json.Marshal(cp)
				if err != nil {
					return fmt.Errorf("failed to marshal challenge payload: %w", err)
				}
				challengePayload = new(string(b))
			}
		}
		if isFactor {
			if !isChallenge {
				verifiedAt = new(now)
				factor.SetLastVerifiedAt(now)
			}
			if fp := factor.Payload(); fp != nil {
				b, err := json.Marshal(fp)
				if err != nil {
					return fmt.Errorf("failed to marshal factor payload: %w", err)
				}
				factorPayload = new(string(b))
			}
		}

		var checkID database.Identity
		err = client.QueryRow(ctx,
			`INSERT INTO checks (project_id, auth_attempt_id, type, last_challenged_at, last_verified_at, challenge_payload, factor_payload, failure_count) VALUES ($1, $2, $3, $4, $5, $6, $7, 0) THEN RETURN id`,
			attempt.ProjectID, database.Identity(attempt.ID), int64(check.Type()), challengedAt, verifiedAt, challengePayload, factorPayload).
			Scan(&checkID)
		if err != nil {
			return fmt.Errorf("failed to create auth attempt check: %w", err)
		}
		if isChallenge {
			challenge.SetID(checkID.String())
		}
	}
	return nil
}

func (a *spannerAuthAttempt) Delete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error {
	_, err := client.Exec(ctx,
		`DELETE FROM auth_attempts WHERE project_id = $1 AND id = $2`,
		projectID, database.Identity(authAttemptID))
	return err
}

func (a *spannerAuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	now := time.Now().UTC()
	_, err := client.Exec(ctx,
		`UPDATE auth_attempts SET handoff_token = $1, handed_off_at = $2 WHERE project_id = $3 AND id = $4`,
		attempt.HandoffToken.TokenHash[:], now, attempt.ProjectID, database.Identity(attempt.ID))
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", err)
	}
	attempt.HandedOffAt = &now
	return nil
}

func (a *spannerAuthAttempt) SetChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenge domain.AuthChallenge) (err error) {
	now := time.Now().UTC()
	var payloadStr *string
	if challenge.Payload() != nil {
		b, err := json.Marshal(challenge.Payload())
		if err != nil {
			return fmt.Errorf("failed to marshal challenge payload: %w", err)
		}
		payloadStr = new(string(b))
	}

	var id database.Identity
	err = client.QueryRow(ctx,
		`INSERT INTO checks (project_id, auth_attempt_id, type, last_challenged_at, challenge_payload, failure_count, last_failed_at)`+
			` VALUES ($1, $2, $3, $4, $5, 0, NULL) ON CONFLICT (project_id, auth_attempt_id, type)`+
			` DO UPDATE SET	last_challenged_at = EXCLUDED.last_challenged_at, challenge_payload = EXCLUDED.challenge_payload, failure_count = 0, last_failed_at = NULL`+
			` THEN RETURN id`,
		projectID, database.Identity(authAttemptID), int64(challenge.Type()), now, payloadStr).
		Scan(&id)
	if err != nil {
		return fmt.Errorf("failed to set challenge: %w", err)
	}
	challenge.SetID(id.String())
	challenge.SetLastChallengedAt(now)
	challenge.SetFailureCount(0)
	challenge.SetLastFailedAt(time.Time{})
	return nil
}

func (a *spannerAuthAttempt) ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, factor domain.AuthFactor, id string) (err error) {
	now := time.Now().UTC()
	var factorStr *string
	if payload := factor.Payload(); payload != nil {
		b, err := json.Marshal(factor.Payload())
		if err != nil {
			return fmt.Errorf("failed to marshal factor payload: %w", err)
		}
		factorStr = new(string(b))
	}

	n, err := client.Exec(ctx,
		`UPDATE checks SET last_verified_at = $1, factor_payload = $2, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0`+
			` WHERE project_id = $3 AND auth_attempt_id = $4 AND type = $5 and id = $6`,
		now, factorStr, projectID, database.Identity(authAttemptID), int64(factor.Type()), database.Identity(id))
	if err != nil {
		return fmt.Errorf("failed to set challenge succeeded: %w", err)
	}
	if n == 0 {
		return domain.ErrAuthAttemptStaleChallenge()
	}
	factor.SetLastVerifiedAt(now)
	return nil
}

func (a *spannerAuthAttempt) ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenge domain.AuthChallenge) error {
	now := time.Now().UTC()
	n, err := client.Exec(ctx,
		`UPDATE checks SET last_failed_at = $1, failure_count = failure_count + 1`+
			` WHERE project_id = $2 AND auth_attempt_id = $3 AND type = $4 and id = $5`,
		now, projectID, database.Identity(authAttemptID), int64(challenge.Type()), database.Identity(challenge.GetID()))
	if err != nil {
		return fmt.Errorf("failed to update challenge failed: %w", err)
	}
	if n == 0 {
		return domain.ErrAuthAttemptStaleChallenge()
	}

	var failureCount int64
	var lastFailedAt time.Time
	err = client.QueryRow(ctx,
		`SELECT failure_count, last_failed_at FROM checks WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3 and id = $4`,
		projectID, database.Identity(authAttemptID), int64(challenge.Type()), database.Identity(challenge.GetID())).
		Scan(&failureCount, &lastFailedAt)
	if err != nil {
		return fmt.Errorf("failed to read failure count: %w", err)
	}
	challenge.SetFailureCount(uint16(failureCount))
	challenge.SetLastFailedAt(lastFailedAt)
	return nil
}

// ── Shared helpers ────────────────────────────────────────────────────────────

func sessionIDArg(sessionID *string) database.Identity {
	if sessionID == nil {
		return ""
	}
	return database.Identity(*sessionID)
}

func newAuthChecks(
	checkType domain.AuthCheckType,
	id string,
	lastChallengedAt, lastFailedAt, verifiedAt time.Time,
	failureCount uint16,
	challenge, factor json.RawMessage,
) (checks []domain.AuthCheck, err error) {
	switch checkType {
	case domain.AuthCheckTypeUser:
		if !verifiedAt.IsZero() {
			userFactor := domain.SetAuthFactorUser(verifiedAt)
			if len(factor) > 0 {
				err = json.Unmarshal(factor, &userFactor)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal user auth check factor payload: %w", err)
				}
			}
			checks = append(checks, userFactor)
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.SetAuthChallengeUser(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePassword:
		if !verifiedAt.IsZero() {
			checks = append(checks, domain.SetAuthFactorPassword(verifiedAt))
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.SetAuthChallengePassword(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePasskey:
		if !verifiedAt.IsZero() {
			passkeyFactor := domain.SetAuthFactorPasskey(verifiedAt)
			if len(factor) > 0 {
				err = json.Unmarshal(factor, passkeyFactor)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check factor payload: %w", err)
				}
			}
			checks = append(checks, passkeyFactor)
		}
		if !lastChallengedAt.IsZero() {
			passkeyCheck := domain.SetAuthChallengePasskey(id, lastChallengedAt, lastFailedAt, failureCount)
			if len(challenge) > 0 {
				err = json.Unmarshal(challenge, passkeyCheck)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check challenge payload: %w", err)
				}
			}
			checks = append(checks, passkeyCheck)
		}
	default:
		log.Println("unsupported auth check type:", checkType)
	}
	return checks, nil
}

type authAttemptCheckCreate struct {
	Type             uint8           `json:"type"`
	ChallengePayload json.RawMessage `json:"challenge_payload,omitempty"`
	FactorPayload    json.RawMessage `json:"factor_payload,omitempty"`
	IsChallenge      bool            `json:"is_challenge"`
	IsFactor         bool            `json:"is_factor"`
}
