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

type authAttemptCheckCreate struct {
	Type             uint8           `json:"type"`
	ChallengePayload json.RawMessage `json:"challenge_payload,omitempty"`
	FactorPayload    json.RawMessage `json:"factor_payload,omitempty"`
}

const authAttemptCheckFailedStmt = `UPDATE zitadel_nextgen.auth_attempt_checks SET` +
	` last_failed_at = NOW(), failure_count = failure_count + 1` +
	` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3` +
	` RETURNING last_failed_at, failure_count`

// CheckFailed implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) CheckFailed(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, check *domain.AuthCheck) error {
	return client.QueryRow(ctx, authAttemptCheckFailedStmt, projectID, authAttemptID, check.Type).
		Scan(&check.LastFailedAt, &check.FailureCount)
}

const authAttemptCheckSucceededStmt = `UPDATE zitadel_nextgen.auth_attempt_checks SET` +
	` verified_at = NOW()` +
	` WHERE project_id = $1 AND auth_attempt_id = $2 AND type = $3` +
	` RETURNING verified_at`

// CheckSucceeded implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) CheckSucceeded(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, check *domain.AuthCheck) error {
	return client.QueryRow(ctx, authAttemptCheckSucceededStmt, projectID, authAttemptID, check.Type).
		Scan(&check.LastVerifiedAt)
}

const authAttemptCompleteStmt = `UPDATE zitadel_nextgen.auth_attempts SET completed_at = NOW()` +
	` WHERE project_id = $1 AND id = $2 RETURNING completed_at`

// Complete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Complete(ctx context.Context, client database.QueryExecutor, attempt *domain.AuthAttempt) error {
	return client.QueryRow(ctx, authAttemptCompleteStmt, attempt.ProjectID, attempt.ID).
		Scan(&attempt.CompletedAt)
}

const authAttemptCreateStmt = `WITH inserted_attempt AS (` +
	` INSERT INTO zitadel_nextgen.auth_attempts (project_id, id, required_checks, time_to_live)` +
	` VALUES ($1, $2, $3::SMALLINT[], $4::INTERVAL)` +
	` RETURNING project_id, id, created_at` +
	`), inserted_checks AS (` +
	` INSERT INTO zitadel_nextgen.auth_attempt_checks (project_id, auth_attempt_id, type, challenge_payload, factor_payload)` +
	` SELECT ia.project_id, ia.id, checks.type, checks.challenge_payload, checks.factor_payload` +
	` FROM inserted_attempt ia` +
	` JOIN LATERAL jsonb_to_recordset(COALESCE($5::JSONB, '[]'::JSONB)) AS checks(type SMALLINT, challenge_payload JSONB, factor_payload JSONB) ON TRUE` +
	` RETURNING type, initiated_at` +
	`) SELECT ia.created_at, ic.type, ic.initiated_at` +
	` FROM inserted_attempt ia` +
	` LEFT JOIN inserted_checks ic ON TRUE`

// Create implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Create(ctx context.Context, client database.QueryExecutor, authAttempt *domain.AuthAttempt) (err error) {
	requiredChecks := make([]uint8, len(authAttempt.RequiredChecks))
	for i, checkType := range authAttempt.RequiredChecks {
		requiredChecks[i] = uint8(checkType)
	}

	checkRows := make([]authAttemptCheckCreate, 0, len(authAttempt.Checks))
	for _, checker := range authAttempt.Checks {
		check := checker.Check()
		checkRow := authAttemptCheckCreate{
			Type: uint8(check.Type),
		}
		if challenge, ok := checker.(domain.AuthChallenger); ok {
			checkRow.ChallengePayload, err = json.Marshal(challenge.ChallengePayload())
			if err != nil {
				return fmt.Errorf("failed to marshal challenge payload: %w", err)
			}
		}
		if factor, ok := checker.(domain.AuthFactorer); ok {
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

	rows, err := client.Query(ctx, authAttemptCreateStmt,
		authAttempt.ProjectID, authAttempt.ID, requiredChecks, authAttempt.TimeToLive, checkRowsJSON)
	if err != nil {
		return fmt.Errorf("failed to create auth attempt: %w", err)
	}
	defer rows.Close()

	initiatedAtByType := make(map[domain.AuthCheckType]time.Time, len(authAttempt.Checks))
	for rows.Next() {
		var (
			createdAt   time.Time
			checkType   database.Null[uint8]
			initiatedAt database.Null[time.Time]
		)
		err = rows.Scan(&createdAt, &checkType, &initiatedAt)
		if err != nil {
			return fmt.Errorf("failed to scan created auth attempt: %w", err)
		}
		authAttempt.CreatedAt = createdAt
		if checkType.Valid && initiatedAt.Valid {
			initiatedAtByType[domain.AuthCheckType(checkType.V)] = initiatedAt.V
		}
	}
	if err = rows.Err(); err != nil {
		return fmt.Errorf("failed to read created auth attempt rows: %w", err)
	}
	if authAttempt.CreatedAt.IsZero() {
		return fmt.Errorf("failed to create auth attempt: no rows returned")
	}

	for _, checker := range authAttempt.Checks {
		if initiatedAt, ok := initiatedAtByType[checker.Check().Type]; ok {
			checker.Check().InitiatedAt = initiatedAt
		}
	}
	return nil
}

const authAttemptDeleteStmt = `DELETE FROM zitadel_nextgen.auth_attempts WHERE project_id = $1 AND id = $2`

// Delete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Delete(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string) error {
	_, err := client.Exec(ctx, authAttemptDeleteStmt, projectID, authAttemptID)
	return err
}

const authAttemptGetStmt = `SELECT aa.project_id, aa.id, aa.required_checks, aa.created_at, aa.completed_at , aac.type,` +
	` aac.initiated_at, aac.verified_at, aac.last_failed_at, aac.failure_count , aac.challenge_payload, aac.factor_payload` +
	` FROM zitadel_nextgen.auth_attempts aa` +
	` LEFT JOIN zitadel_nextgen.auth_attempt_checks aac ON aa.project_id = aac.project_id AND aa.id = aac.auth_attempt_id` +
	` WHERE aa.project_id = $1 AND aa.id = $2`

// Get implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Get(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	rows, err := client.Query(ctx, authAttemptGetStmt, projectID, authAttemptID)
	if err != nil {
		return nil, fmt.Errorf("failed to query auth attempt: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			checkType         database.Null[domain.AuthCheckType]
			initiatedAt       database.Null[time.Time]
			verifiedAt        database.Null[time.Time]
			lastFailedAt      database.Null[time.Time]
			failureCount      database.Null[uint16]
			challenge, factor json.RawMessage
		)
		err = rows.Scan(&attempt.ProjectID, &attempt.ID, &attempt.RequiredChecks, &attempt.CreatedAt, &attempt.CompletedAt, &checkType,
			&initiatedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor)
		if err != nil {
			return nil, fmt.Errorf("failed to scan auth attempt: %w", err)
		}

		if !checkType.Valid {
			continue
		}

		check := domain.AuthCheck{Type: checkType.V}
		if initiatedAt.Valid {
			check.InitiatedAt = initiatedAt.V
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
			return nil, fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		attempt.Checks = append(attempt.Checks, checker)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read auth attempt rows: %w", err)
	}
	return attempt, nil
}

// Handoff implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, sessionID string) error {
	panic("unimplemented")
}

const authAttemptSetCheckStmt = `INSERT INTO zitadel_nextgen.auth_attempt_checks` +
	` (project_id, auth_attempt_id, type, challenge_payload, factor_payload)` +
	` VALUES ($1, $2, $3, $4, $5)` +
	` ON CONFLICT (project_id, auth_attempt_id, type) DO UPDATE SET` +
	` challenge_payload = EXCLUDED.challenge_payload, factor_payload = EXCLUDED.factor_payload` +
	` RETURNING initiated_at`

// SetCheck implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) SetCheck(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, checker domain.AuthChecker) (err error) {
	check := checker.Check()
	var challengePayload, factorPayload json.RawMessage
	if challenge, ok := checker.(domain.AuthChallenger); ok {
		challengePayload, err = json.Marshal(challenge.ChallengePayload())
		if err != nil {
			return fmt.Errorf("failed to marshal challenge payload: %w", err)
		}
	}
	if factor, ok := checker.(domain.AuthFactorer); ok {
		factorPayload, err = json.Marshal(factor.FactorPayload())
		if err != nil {
			return fmt.Errorf("failed to marshal factor payload: %w", err)
		}
	}
	return client.QueryRow(ctx, authAttemptSetCheckStmt,
		projectID, authAttemptID, check.Type, challengePayload, factorPayload).
		Scan(&check.InitiatedAt)
}

var _ domain.AuthAttemptRepository = (*AuthAttempt)(nil)

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
	default:
		log.Println("unsupported auth check type:", check.Type)
		return check, nil
	}
}
