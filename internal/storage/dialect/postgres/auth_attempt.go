package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authattempt"
	"github.com/zitadel/nextgen/internal/storage/session"
)

const authAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
	` aa.required_checks, aa.created_at, c.type, aa.time_to_live,` +
	` c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
	` FROM zitadel_nextgen.auth_attempts aa` +
	` LEFT JOIN zitadel_nextgen.checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`

const createAuthAttemptStmt = `WITH inserted_attempt AS (` +
	` INSERT INTO zitadel_nextgen.auth_attempts (project_id, id, required_checks, time_to_live, session_id)` +
	` VALUES ($1, $2, $3::SMALLINT[], $4::INTERVAL, $5)` +
	` RETURNING project_id, id, created_at` +
	`), inserted_checks AS (` +
	` INSERT INTO zitadel_nextgen.checks (project_id, auth_attempt_id, id, type, challenge_payload, factor_payload, last_challenged_at, last_verified_at)` +
	` SELECT ia.project_id, ia.id, checks.id, checks.type, checks.challenge_payload, checks.factor_payload,` +
	` CASE WHEN checks.is_challenge THEN NOW() ELSE NULL END,` +
	` CASE WHEN checks.is_factor AND NOT checks.is_challenge THEN NOW() ELSE NULL END` +
	` FROM inserted_attempt ia` +
	` JOIN LATERAL jsonb_to_recordset(COALESCE($6::JSONB, '[]'::JSONB)) AS checks(id TEXT, type SMALLINT, challenge_payload JSONB, factor_payload JSONB, is_challenge BOOLEAN, is_factor BOOLEAN) ON TRUE` +
	` RETURNING id, type, last_challenged_at, last_verified_at` +
	`) SELECT ia.id, ia.created_at, ic.id, ic.type, ic.last_challenged_at, ic.last_verified_at` +
	` FROM inserted_attempt ia` +
	` LEFT JOIN inserted_checks ic ON TRUE`

const deleteAuthAttemptByIDStmt = `DELETE FROM zitadel_nextgen.auth_attempts WHERE project_id = $1 AND id = $2`

const handoffAuthAttemptStmt = `UPDATE zitadel_nextgen.auth_attempts SET handoff_token = $3, handed_off_at = NOW() WHERE project_id = $1 AND id = $2 RETURNING handed_off_at`

const setAuthAttemptChallengeStmt = `INSERT INTO zitadel_nextgen.checks` +
	` (project_id, auth_attempt_id, type, id, last_challenged_at, challenge_payload)` +
	` VALUES ($1, $2, $3, $4, NOW(), $5::JSONB)` +
	` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET` +
	` id = EXCLUDED.id,` +
	` last_challenged_at = NOW(), challenge_payload = EXCLUDED.challenge_payload, failure_count = 0, last_failed_at = NULL` +
	` RETURNING id, last_challenged_at`

const setAuthAttemptFactorStmt = `INSERT INTO zitadel_nextgen.checks` +
	` (project_id, auth_attempt_id, type, id, last_verified_at, factor_payload)` +
	` VALUES ($1, $2, $3, $4, NOW(), $5::JSONB)` +
	` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET` +
	` last_verified_at = NOW(), factor_payload = EXCLUDED.factor_payload,` +
	` challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0, last_failed_at = NULL` +
	` RETURNING id, last_verified_at`

const authAttemptChallengeSucceededStmt = `UPDATE zitadel_nextgen.checks` +
	` SET last_verified_at = NOW(), factor_payload = $4::JSONB, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0` +
	` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3 AND id = $5` +
	` RETURNING last_verified_at`

const authAttemptChallengeFailedStmt = `UPDATE zitadel_nextgen.checks` +
	` SET last_failed_at = NOW(), failure_count = failure_count + 1` +
	` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3 AND id = $4` +
	` RETURNING last_failed_at, failure_count`

type authAttemptStatements struct{ statement }

func newAuthAttemptStatements(client queryExecutor) authAttemptStatements {
	return authAttemptStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateAuthAttempt implements [service.AuthAttemptStatements].
func (as authAttemptStatements) CreateAuthAttempt(ctx context.Context, authAttempt *domain.AuthAttempt) error {
	if err := ensureManagedID(&authAttempt.ID, domain.PrefixAuthAttempt); err != nil {
		return err
	}
	checkIDs := make([]string, len(authAttempt.Checks))
	for i := range authAttempt.Checks {
		if err := ensureManagedID(&checkIDs[i], domain.PrefixChallenge); err != nil {
			return err
		}
	}
	checkRowsJSON, err := authattempt.ChecksToJSON(authAttempt.Checks, checkIDs)
	if err != nil {
		return err
	}

	requiredChecks := make([]int16, len(authAttempt.RequiredChecks))
	for i, c := range authAttempt.RequiredChecks {
		requiredChecks[i] = int16(c)
	}

	rows, err := as.client.Query(ctx, createAuthAttemptStmt,
		authAttempt.ProjectID, authAttempt.ID, requiredChecks, authAttempt.TimeToLive,
		authattempt.SessionIDArg(authAttempt.SessionID), checkRowsJSON)
	if err != nil {
		return wrapError(err)
	}
	defer rows.Close()

	challengeIDByType := make(map[domain.AuthCheckType]string, len(authAttempt.Checks))
	lastChallengedAtByType := make(map[domain.AuthCheckType]time.Time, len(authAttempt.Checks))
	lastVerifiedAtByType := make(map[domain.AuthCheckType]time.Time, len(authAttempt.Checks))
	for rows.Next() {
		var (
			attemptID        string
			createdAt        time.Time
			challengeID      *string
			checkType        *uint8
			lastChallengedAt *time.Time
			lastVerifiedAt   *time.Time
		)
		err = rows.Scan(&attemptID, &createdAt, &challengeID, &checkType, &lastChallengedAt, &lastVerifiedAt)
		if err != nil {
			return wrapError(err)
		}
		authAttempt.ID = attemptID
		authAttempt.CreatedAt = createdAt
		if checkType != nil {
			checkTypeV := domain.AuthCheckType(*checkType)
			if challengeID != nil && *challengeID != "" {
				challengeIDByType[checkTypeV] = *challengeID
			}
			if lastChallengedAt != nil {
				lastChallengedAtByType[checkTypeV] = *lastChallengedAt
			}
			if lastVerifiedAt != nil {
				lastVerifiedAtByType[checkTypeV] = *lastVerifiedAt
			}
		}
	}
	if err = rows.Err(); err != nil {
		return wrapError(err)
	}
	if authAttempt.ID == "" || authAttempt.CreatedAt.IsZero() {
		return fmt.Errorf("failed to create auth attempt: no rows returned")
	}

	for _, check := range authAttempt.Checks {
		if t, ok := challengeIDByType[check.Type()]; ok {
			if challenge, ok := check.(domain.AuthChallenge); ok {
				challenge.SetID(t)
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

// GetAuthAttemptByID implements [service.AuthAttemptStatements].
func (as authAttemptStatements) GetAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	var c statementCompiler
	c.WriteString(authAttemptGetSelect)
	c.WriteString(" WHERE aa.project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND aa.id = ")
	c.WriteArg(database.Identity(authAttemptID))
	return as.get(ctx, c.String(), c.args...)
}

// GetAuthAttemptByHandoffToken implements [service.AuthAttemptStatements].
func (as authAttemptStatements) GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffToken []byte) (*domain.AuthAttempt, error) {
	var c statementCompiler
	c.WriteString(authAttemptGetSelect)
	c.WriteString(" WHERE aa.project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND aa.handoff_token = ")
	c.WriteArg(handoffToken)
	return as.get(ctx, c.String(), c.args...)
}

func (as authAttemptStatements) get(ctx context.Context, query string, args ...any) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := as.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	if err := as.scan(rows, attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}

func (as authAttemptStatements) scan(rows pgx.Rows, attempt *domain.AuthAttempt) error {
	var found bool
	for rows.Next() {
		found = true
		var (
			handoffToken     []byte
			handedOffAt      *time.Time
			sessionID        *string
			requiredChecks   []int16
			checkType        *domain.AuthCheckType
			timeToLive       *time.Duration
			challengeID      *string
			lastChallengedAt *time.Time
			verifiedAt       *time.Time
			lastFailedAt     *time.Time
			failureCount     *uint16
			challenge        []byte
			factor           []byte
		)
		err := rows.Scan(
			&attempt.ProjectID, &attempt.ID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &checkType, &timeToLive,
			&challengeID, &lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor)
		if err != nil {
			return wrapError(err)
		}

		attempt.RequiredChecks = make([]domain.AuthCheckType, len(requiredChecks))
		for i, c := range requiredChecks {
			attempt.RequiredChecks[i] = domain.AuthCheckType(c)
		}
		if len(handoffToken) > 0 {
			attempt.HandoffToken = &domain.HandoffToken{TokenHash: handoffToken}
		}
		if handedOffAt != nil {
			attempt.HandedOffAt = handedOffAt
		}
		attempt.SessionID = sessionID
		attempt.TimeToLive = timeToLive

		if checkType == nil {
			continue
		}
		var (
			challengeIDV      string
			lastChallengedAtV time.Time
			lastFailedAtV     time.Time
			verifiedAtV       time.Time
			failureCountV     uint16
		)
		if challengeID != nil {
			challengeIDV = *challengeID
		}
		if lastChallengedAt != nil {
			lastChallengedAtV = *lastChallengedAt
		}
		if lastFailedAt != nil {
			lastFailedAtV = *lastFailedAt
		}
		if verifiedAt != nil {
			verifiedAtV = *verifiedAt
		}
		if failureCount != nil {
			failureCountV = *failureCount
		}
		checks, err := session.DecodeAuthChecks(*checkType, challengeIDV, lastChallengedAtV, lastFailedAtV, verifiedAtV, failureCountV, challenge, factor)
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
	if err := rows.Err(); err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteAuthAttemptByID implements [service.AuthAttemptStatements].
func (as authAttemptStatements) DeleteAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) error {
	_, err := as.client.Exec(ctx, deleteAuthAttemptByIDStmt, projectID, authAttemptID)
	return wrapError(err)
}

// HandoffAuthAttempt implements [service.AuthAttemptStatements].
func (as authAttemptStatements) HandoffAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	var handedOffAt time.Time
	err := as.client.QueryRow(ctx, handoffAuthAttemptStmt,
		attempt.ProjectID, attempt.ID, attempt.HandoffToken.TokenHash).Scan(&handedOffAt)
	if err != nil {
		return wrapError(err)
	}
	attempt.HandedOffAt = &handedOffAt
	return nil
}

// SetAuthAttemptChallenge implements [service.AuthAttemptStatements].
func (as authAttemptStatements) SetAuthAttemptChallenge(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error {
	payload, err := authattempt.MarshalPayloadJSON(challenge.Payload())
	if err != nil {
		return fmt.Errorf("failed to marshal challenge payload: %w", err)
	}
	var checkID string
	if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
		return err
	}
	var id string
	var lastChallengedAt time.Time
	err = as.client.QueryRow(ctx, setAuthAttemptChallengeStmt,
		projectID, authAttemptID, challenge.Type(), checkID, payload).
		Scan(&id, &lastChallengedAt)
	if err != nil {
		return wrapError(err)
	}
	challenge.SetID(id)
	challenge.SetLastChallengedAt(lastChallengedAt)
	challenge.SetFailureCount(0)
	challenge.SetLastFailedAt(time.Time{})
	return nil
}

// SetAuthAttemptFactor implements [service.AuthAttemptStatements].
func (as authAttemptStatements) SetAuthAttemptFactor(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor) (string, error) {
	payload, err := authattempt.MarshalPayloadJSON(factor.Payload())
	if err != nil {
		return "", fmt.Errorf("failed to marshal factor payload: %w", err)
	}
	var checkID string
	if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
		return "", err
	}
	var id string
	var lastVerifiedAt time.Time
	err = as.client.QueryRow(ctx, setAuthAttemptFactorStmt,
		projectID, authAttemptID, factor.Type(), checkID, payload).
		Scan(&id, &lastVerifiedAt)
	if err != nil {
		return "", wrapError(err)
	}
	factor.SetLastVerifiedAt(lastVerifiedAt)
	return id, nil
}

// AuthAttemptChallengeSucceeded implements [service.AuthAttemptStatements].
func (as authAttemptStatements) AuthAttemptChallengeSucceeded(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor, challengeID string) error {
	factorPayload, err := authattempt.MarshalPayloadJSON(factor.Payload())
	if err != nil {
		return fmt.Errorf("failed to marshal factor payload: %w", err)
	}
	var lastVerifiedAt time.Time
	err = as.client.QueryRow(ctx, authAttemptChallengeSucceededStmt,
		projectID, authAttemptID, factor.Type(), factorPayload, challengeID).
		Scan(&lastVerifiedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrAuthAttemptStaleChallenge()
		}
		return wrapError(err)
	}
	factor.SetLastVerifiedAt(lastVerifiedAt)
	return nil
}

// AuthAttemptChallengeFailed implements [service.AuthAttemptStatements].
func (as authAttemptStatements) AuthAttemptChallengeFailed(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error {
	var lastFailedAt time.Time
	var failureCount uint16
	err := as.client.QueryRow(ctx, authAttemptChallengeFailedStmt,
		projectID, authAttemptID, challenge.Type(), challenge.GetID()).
		Scan(&lastFailedAt, &failureCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrAuthAttemptStaleChallenge()
		}
		return wrapError(err)
	}
	challenge.SetLastFailedAt(lastFailedAt)
	challenge.SetFailureCount(failureCount)
	return nil
}

var _ service.AuthAttemptStatements = (*authAttemptStatements)(nil)
