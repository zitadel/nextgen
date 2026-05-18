package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type AuthAttempt struct{}

const authAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.handoff_idempotency_key, aa.session_id, aa.required_checks, aa.created_at, aa.completed_at, aac.type, aa.time_to_live,` +
	` aac.last_challenged_at, aac.last_verified_at, aac.last_failed_at, aac.failure_count, aac.challenge_payload, aac.factor_payload, aac.challenge_id` +
	` FROM zitadel_nextgen.auth_attempts aa` +
	` LEFT JOIN zitadel_nextgen.auth_attempt_checks aac ON aa.project_id = aac.project_id AND aa.id = aac.auth_attempt_id`

const authAttemptGetByIDStmt = authAttemptGetSelect +
	` WHERE aa.project_id = $1 AND aa.id = $2`

const authAttemptGetByHandoffTokenStmt = authAttemptGetSelect +
	` WHERE aa.project_id = $1 AND aa.handoff_token = $2`

// GetByID implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) GetByID(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, authAttemptGetByIDStmt, projectID, authAttemptID)
}

// GetByHandoffToken implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) GetByHandoffToken(ctx context.Context, client database.QueryExecutor, projectID, handoffToken string) (*domain.AuthAttempt, error) {
	return a.get(ctx, client, authAttemptGetByHandoffTokenStmt, projectID, handoffToken)
}

func (a *AuthAttempt) get(ctx context.Context, client database.QueryExecutor, query, projectID, matcher string) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := client.Query(ctx, query, projectID, matcher)
	if err != nil {
		return nil, fmt.Errorf("failed to query auth attempt: %w", err)
	}
	defer rows.Close()
	var found bool
	for rows.Next() {
		found = true
		var (
			handoffToken          database.Null[[]byte]
			handedOffAt           database.Null[time.Time]
			handoffIdempotencyKey database.Null[string]
			sessionID             database.Null[string]
			checkType             database.Null[domain.AuthCheckType]
			lastChallengedAt      database.Null[time.Time]
			verifiedAt            database.Null[time.Time]
			lastFailedAt          database.Null[time.Time]
			failureCount          database.Null[uint16]
			challenge, factor     json.RawMessage
			challengeID           database.Null[string]
		)
		err = rows.Scan(&attempt.ProjectID, &attempt.ID, &handoffToken, &handedOffAt, &handoffIdempotencyKey, &sessionID, &attempt.RequiredChecks, &attempt.CreatedAt, &attempt.CompletedAt, &checkType, &attempt.TimeToLive,
			&lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor, &challengeID)
		if err != nil {
			return nil, fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		if handoffToken.Valid {
			attempt.HandoffToken = &domain.HandoffToken{EncryptedToken: handoffToken.V}
		}
		if handedOffAt.Valid {
			attempt.HandedOffAt = &handedOffAt.V
		}
		if handoffIdempotencyKey.Valid {
			attempt.HandoffIdempotencyKey = &handoffIdempotencyKey.V
		}
		if sessionID.Valid {
			attempt.SessionID = &sessionID.V
		}

		if !checkType.Valid {
			continue
		}

		checkers, err := newAuthChecks(checkType.V, challengeID.V, lastChallengedAt.V, lastFailedAt.V, verifiedAt.V, failureCount.V, challenge, factor)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		for _, checker := range checkers {
			attempt.SetCheck(checker)
		}
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read auth attempt rows: %w", err)
	}
	if !found {
		return nil, domain.ErrAuthAttemptNotFound()
	}
	return attempt, nil
}

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
func (a *AuthAttempt) Create(ctx context.Context, client database.QueryExecutor, authAttempt *domain.AuthAttempt) (err error) {
	checkRows := make([]authAttemptCheckCreate, 0, len(authAttempt.Checks))

	for _, checker := range authAttempt.Checks {
		checkRow := authAttemptCheckCreate{
			Type: uint8(checker.Type()),
		}
		if challenge, ok := checker.(domain.AuthChallenge); ok {
			checkRow.IsChallenger = true
			checkRow.ChallengePayload, err = json.Marshal(challenge.Payload())
			if err != nil {
				return fmt.Errorf("failed to marshal challenge payload: %w", err)
			}
		}
		if factor, ok := checker.(domain.AuthFactor); ok {
			checkRow.IsFactorer = true
			checkRow.FactorPayload, err = json.Marshal(factor.Payload())
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

	rows, err := client.Query(ctx, authAttemptCreateStmt,
		authAttempt.ProjectID, authAttempt.ID, authAttempt.RequiredChecks, authAttempt.TimeToLive, authAttempt.SessionID, checkRowsJSON)
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
		if lastChallengedAt, ok := lastChallengedAtByType[checker.Type()]; ok {
			if challenge, ok := checker.(domain.AuthChallenge); ok {
				challenge.SetLastChallengedAt(lastChallengedAt)
			}
		}
		if lastVerifiedAt, ok := lastVerifiedAtByType[checker.Type()]; ok {
			if factor, ok := checker.(domain.AuthFactor); ok {
				factor.SetLastVerifiedAt(lastVerifiedAt)
			}
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

const authAttemptDeleteStmt = `DELETE FROM zitadel_nextgen.auth_attempts WHERE project_id = $1 AND id = $2`

// Delete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Delete(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string) error {
	_, err := client.Exec(ctx, authAttemptDeleteStmt, projectID, authAttemptID)
	return err
}

const authAttemptCompleteStmt = `UPDATE zitadel_nextgen.auth_attempts SET completed_at = NOW()` +
	` WHERE project_id = $1 AND id = $2 RETURNING completed_at`

// Complete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Complete(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	return client.QueryRow(ctx, authAttemptCompleteStmt, attempt.ProjectID, attempt.ID).
		Scan(&attempt.CompletedAt)
}

const authAttemptHandoffStmt = `UPDATE zitadel_nextgen.auth_attempts SET handoff_token = $3, handed_off_at = NOW(), handoff_idempotency_key = $4` +
	` WHERE project_id = $1 AND id = $2 RETURNING handed_off_at`

// Handoff implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt, idempotencyKey string) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	var handedOffAt time.Time
	err := client.QueryRow(ctx, authAttemptHandoffStmt, attempt.ProjectID, attempt.ID, attempt.HandoffToken.EncryptedToken, idempotencyKey).
		Scan(&handedOffAt)
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", err)
	}
	attempt.HandedOffAt = &handedOffAt
	return nil
}

const authAttemptSetChallengeStmt = `INSERT INTO zitadel_nextgen.auth_attempt_checks` +
	` (project_id, auth_attempt_id, type, last_challenged_at, challenge_payload, challenge_id)` +
	` VALUES ($1, $2, $3, NOW(), $4::JSONB, $5)` +
	` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET` +
	` last_challenged_at = NOW(), challenge_payload = EXCLUDED.challenge_payload, challenge_id = EXCLUDED.challenge_id, failure_count = 0, last_failed_at = NULL` +
	` RETURNING last_challenged_at`

// SetChallenge implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) SetChallenge(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, challenger domain.AuthChallenge) (err error) {
	var payload json.RawMessage
	if challenger.Payload() != nil {
		payload, err = json.Marshal(challenger.Payload())
		if err != nil {
			return fmt.Errorf("failed to marshal challenge payload: %w", err)
		}
	}
	var lastChallengedAt time.Time
	err = client.QueryRow(ctx, authAttemptSetChallengeStmt, projectID, authAttemptID, challenger.Type(), payload, challenger.GetID()).
		Scan(&lastChallengedAt)
	if err != nil {
		return err
	}
	challenger.SetLastChallengedAt(lastChallengedAt)
	return nil
}

const authAttemptChallengeSucceededStmt = `UPDATE zitadel_nextgen.auth_attempt_checks` +
	` SET last_verified_at = NOW(), factor_payload = $4::JSONB, challenge_payload = NULL, challenge_id = NULL` +
	` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3 AND challenge_id = $5` +
	` RETURNING last_verified_at`

// ChallengeSucceeded implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, check domain.AuthFactor, id string) (err error) {
	var factorPayload json.RawMessage
	if check.Payload() != nil {
		factorPayload, err = json.Marshal(check.Payload())
		if err != nil {
			return fmt.Errorf("failed to marshal factor payload: %w", err)
		}
	}
	var lastVerifiedAt time.Time
	err = client.QueryRow(ctx, authAttemptChallengeSucceededStmt, projectID, authAttemptID, check.Type(), factorPayload, id).
		Scan(&lastVerifiedAt)
	if err != nil {
		// No rows mean the challenge_id didn't match — it was re-issued or already consumed
		return domain.ErrAuthAttemptStaleChallenge()
	}
	check.SetLastVerifiedAt(lastVerifiedAt)
	return nil
}

const authAttemptChallengeFailedStmt = `UPDATE zitadel_nextgen.auth_attempt_checks` +
	` SET last_failed_at = NOW(), failure_count = failure_count + 1` +
	` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3 AND challenge_id = $4` +
	` RETURNING last_failed_at, failure_count`

// ChallengeFailed implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, challenger domain.AuthChallenge) error {
	var lastFailedAt time.Time
	var failureCount uint16
	err := client.QueryRow(ctx, authAttemptChallengeFailedStmt, projectID, authAttemptID, challenger.Type(), challenger.GetID()).
		Scan(&lastFailedAt, &failureCount)
	if err != nil {
		return err
	}
	challenger.SetLastFailedAt(lastFailedAt)
	challenger.SetFailureCount(failureCount)
	return nil
}

var _ domain.AuthAttemptRepository = (*AuthAttempt)(nil)

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
			userFactor := domain.NewAuthFactorUser("", verifiedAt)
			if len(factor) > 0 {
				err = json.Unmarshal(factor, &userFactor)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal user auth check factor payload: %w", err)
				}
			}
			checks = append(checks, userFactor)
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.NewAuthChallengeUser(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePassword:
		if !verifiedAt.IsZero() {
			checks = append(checks, domain.NewAuthFactorPassword(verifiedAt))
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.NewAuthChallengePassword(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePasskey:
		if !verifiedAt.IsZero() {
			passkeyFactor := domain.NewAuthFactorPasskey(verifiedAt)
			if len(factor) > 0 {
				err = json.Unmarshal(factor, passkeyFactor)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check factor payload: %w", err)
				}
			}
			checks = append(checks, passkeyFactor)
		}
		if !lastChallengedAt.IsZero() {
			passkeyCheck := domain.NewAuthChallengePasskey(id, lastChallengedAt, lastFailedAt, failureCount)
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
