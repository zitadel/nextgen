package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authattempt"
	v2session "github.com/zitadel/nextgen/internal/storage/session"
)

const (
	authAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
		` aa.required_checks, aa.created_at, c.type, aa.time_to_live, aa.internal,` +
		` c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
		` FROM auth_attempts aa` +
		` LEFT JOIN checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`

	createAuthAttemptStmt = `INSERT INTO auth_attempts (project_id, id, required_checks, time_to_live, session_id, created_at, internal)
VALUES (?, ?, ?, ?, ?, ?, ?)`

	createAuthCheckStmt = `INSERT INTO checks (project_id, auth_attempt_id, id, type, last_challenged_at, last_verified_at, challenge_payload, factor_payload, failure_count)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`

	deleteAuthAttemptByIDStmt = `DELETE FROM auth_attempts WHERE project_id = ? AND id = ?`

	handoffAuthAttemptStmt = `UPDATE auth_attempts SET handoff_token = ?, handed_off_at = ? WHERE project_id = ? AND id = ? RETURNING handed_off_at`

	setAuthAttemptChallengeStmt = `INSERT INTO checks (project_id, auth_attempt_id, id, type, last_challenged_at, challenge_payload, failure_count, last_failed_at)` +
		` VALUES (?, ?, ?, ?, ?, ?, 0, NULL) ON CONFLICT (project_id, auth_attempt_id, type)` +
		` DO UPDATE SET id = excluded.id, last_challenged_at = EXCLUDED.last_challenged_at, challenge_payload = EXCLUDED.challenge_payload, failure_count = 0, last_failed_at = NULL` +
		` RETURNING id`

	setAuthAttemptFactorStmt = `INSERT INTO checks (project_id, auth_attempt_id, id, type, last_verified_at, factor_payload, failure_count)` +
		` VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT (project_id, auth_attempt_id, type)` +
		` DO UPDATE SET last_verified_at = EXCLUDED.last_verified_at, factor_payload = EXCLUDED.factor_payload,` +
		` challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0, last_failed_at = NULL` +
		` RETURNING id`

	authAttemptChallengeSucceededStmt = `UPDATE checks SET last_verified_at = ?, factor_payload = ?, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0` +
		` WHERE project_id = ? AND auth_attempt_id = ? AND type = ? AND id = ?`

	issueSSOStateStmt = `INSERT INTO checks (project_id, auth_attempt_id, type, id, last_challenged_at, challenge_payload, lookup_hash, failure_count, last_failed_at)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL) ON CONFLICT (project_id, auth_attempt_id, type)` +
		` DO UPDATE SET id = EXCLUDED.id, last_challenged_at = EXCLUDED.last_challenged_at, challenge_payload = EXCLUDED.challenge_payload,` +
		` lookup_hash = EXCLUDED.lookup_hash,` +
		` factor_payload = NULL, last_verified_at = NULL, failure_count = 0, last_failed_at = NULL` +
		` RETURNING id`

	selectPendingSSOStateStmt = `SELECT c.id, c.auth_attempt_id, c.challenge_payload, aa.created_at, aa.time_to_live` +
		` FROM checks c` +
		` JOIN auth_attempts aa ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id` +
		` WHERE c.project_id = ? AND c.lookup_hash = ? AND c.type = ? AND c.last_challenged_at IS NOT NULL`

	consumeSSOStateStmt = `UPDATE checks SET challenge_payload = NULL, last_challenged_at = NULL, factor_payload = NULL` +
		` WHERE project_id = ? AND lookup_hash = ? AND type = ? AND last_challenged_at IS NOT NULL`

	setSSOCallbackResultStmt = `UPDATE checks SET factor_payload = ?` +
		` WHERE project_id = ? AND lookup_hash = ? AND type = ? AND last_challenged_at IS NULL`

	authAttemptChallengeFailedStmt = `UPDATE checks SET last_failed_at = ?, failure_count = failure_count + 1` +
		` WHERE project_id = ? AND auth_attempt_id = ? AND type = ? AND id = ?` +
		` RETURNING failure_count, last_failed_at`
)

type authAttemptStatements struct{ statement }

func newAuthAttemptStatements(client queryExecutor) authAttemptStatements {
	return authAttemptStatements{statement: statement{client: client}}
}

// CreateAuthAttempt implements [service.AuthAttemptStatements].
func (as authAttemptStatements) CreateAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error {
	if err := ensureManagedID(&attempt.ID, domain.PrefixAuthAttempt); err != nil {
		return err
	}
	now := time.Now().UTC()

	req, err := json.Marshal(func() []int64 {
		out := make([]int64, len(attempt.RequiredChecks))
		for i, c := range attempt.RequiredChecks {
			out[i] = int64(c)
		}
		return out
	}())
	if err != nil {
		return fmt.Errorf("failed to marshal required_checks: %w", err)
	}

	var ttlNanos any
	if attempt.TimeToLive != nil {
		ttlNanos = attempt.TimeToLive.Nanoseconds()
	}

	var sessionID any
	if attempt.SessionID != nil && *attempt.SessionID != "" {
		sessionID = *attempt.SessionID
	}

	checkIDs := make([]string, len(attempt.Checks))
	for i := range attempt.Checks {
		if err := ensureManagedID(&checkIDs[i], domain.PrefixChallenge); err != nil {
			return err
		}
	}

	return withTransaction(ctx, as.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createAuthAttemptStmt,
			attempt.ProjectID, attempt.ID, string(req), ttlNanos, sessionID, now.UnixNano(), attempt.Internal,
		); err != nil {
			return fmt.Errorf("failed to create auth attempt: %w", wrapError(err))
		}
		attempt.CreatedAt = now

		for i, check := range attempt.Checks {
			challenge, isChallenge := check.(domain.AuthChallenge)
			factor, isFactor := check.(domain.AuthFactor)

			var challengedAtNano, verifiedAtNano any
			var challengePayload, factorPayload any

			if isChallenge {
				challengedAtNano = now.UnixNano()
				challenge.SetLastChallengedAt(now)
				challenge.SetID(checkIDs[i])
				p, err := authattempt.MarshalPayloadString(challenge.Payload())
				if err != nil {
					return fmt.Errorf("failed to marshal challenge payload: %w", err)
				}
				if p != nil {
					challengePayload = *p
				}
			}
			if isFactor {
				if !isChallenge {
					verifiedAtNano = now.UnixNano()
					factor.SetLastVerifiedAt(now)
				}
				p, err := authattempt.MarshalPayloadString(factor.Payload())
				if err != nil {
					return fmt.Errorf("failed to marshal factor payload: %w", err)
				}
				if p != nil {
					factorPayload = *p
				}
			}

			if _, err := tx.Exec(ctx, createAuthCheckStmt,
				attempt.ProjectID, attempt.ID, checkIDs[i], int64(check.Type()),
				challengedAtNano, verifiedAtNano, challengePayload, factorPayload,
			); err != nil {
				return fmt.Errorf("failed to create auth attempt check: %w", wrapError(err))
			}
		}
		return nil
	})
}

// GetAuthAttemptByID implements [service.AuthAttemptStatements].
func (as authAttemptStatements) GetAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	var c statementCompiler
	c.WriteString(authAttemptGetSelect)
	c.WriteString(" WHERE aa.project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND aa.id = ")
	c.WriteArg(authAttemptID)
	return as.getAttempt(ctx, c.String(), c.args...)
}

// GetAuthAttemptByHandoffToken implements [service.AuthAttemptStatements].
func (as authAttemptStatements) GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffToken []byte) (*domain.AuthAttempt, error) {
	var c statementCompiler
	c.WriteString(authAttemptGetSelect)
	c.WriteString(" WHERE aa.project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND aa.handoff_token = ")
	c.WriteArg(handoffToken)
	return as.getAttempt(ctx, c.String(), c.args...)
}

func (as authAttemptStatements) getAttempt(ctx context.Context, query string, args ...any) (*domain.AuthAttempt, error) {
	rows, err := as.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	attempt := new(domain.AuthAttempt)
	if err := scanAuthAttemptRows(rows, attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}

func scanAuthAttemptRows(rows *sql.Rows, attempt *domain.AuthAttempt) error {
	var found bool
	for rows.Next() {
		found = true
		var (
			attemptID          string
			handoffToken       []byte
			handedOffAtNano    sql.NullInt64
			sessionIDVal       sql.NullString
			requiredChecksJSON sql.NullString
			checkType          sql.NullInt64
			timeToLiveNano     sql.NullInt64
			checkID            sql.NullString
			lastChallengedNano sql.NullInt64
			verifiedAtNano     sql.NullInt64
			lastFailedAtNano   sql.NullInt64
			failureCount       sql.NullInt64
			challengePayload   sql.NullString
			factorPayload      sql.NullString
			createdNano        int64
			internalInt        int64
		)
		if err := rows.Scan(
			&attempt.ProjectID, &attemptID, &handoffToken, &handedOffAtNano, &sessionIDVal,
			&requiredChecksJSON, &createdNano, &checkType, &timeToLiveNano, &internalInt,
			&checkID, &lastChallengedNano, &verifiedAtNano, &lastFailedAtNano, &failureCount,
			&challengePayload, &factorPayload,
		); err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		attempt.ID = attemptID
		attempt.CreatedAt = timeFromUnixNano(createdNano)
		attempt.Internal = internalInt != 0

		if attempt.RequiredChecks == nil && requiredChecksJSON.Valid {
			var reqInts []int64
			if err := json.Unmarshal([]byte(requiredChecksJSON.String), &reqInts); err != nil {
				return fmt.Errorf("failed to unmarshal required_checks: %w", err)
			}
			attempt.RequiredChecks = make([]domain.AuthCheckType, len(reqInts))
			for i, c := range reqInts {
				attempt.RequiredChecks[i] = domain.AuthCheckType(c)
			}
		}

		if len(handoffToken) > 0 {
			attempt.HandoffToken = &domain.HandoffToken{TokenHash: handoffToken}
		}
		if handedOffAtNano.Valid {
			t := timeFromUnixNano(handedOffAtNano.Int64)
			attempt.HandedOffAt = &t
		}
		if sessionIDVal.Valid {
			s := sessionIDVal.String
			attempt.SessionID = &s
		}
		if timeToLiveNano.Valid {
			d := time.Duration(timeToLiveNano.Int64)
			attempt.TimeToLive = &d
		}

		if !checkType.Valid || !checkID.Valid || checkID.String == "" {
			continue
		}
		var (
			lastChallengedAt time.Time
			lastFailedAt     time.Time
			verifiedAt       time.Time
			fc               uint16
		)
		if lastChallengedNano.Valid {
			lastChallengedAt = timeFromUnixNano(lastChallengedNano.Int64)
		}
		if lastFailedAtNano.Valid {
			lastFailedAt = timeFromUnixNano(lastFailedAtNano.Int64)
		}
		if verifiedAtNano.Valid {
			verifiedAt = timeFromUnixNano(verifiedAtNano.Int64)
		}
		if failureCount.Valid {
			fc = uint16(failureCount.Int64)
		}
		checks, err := v2session.DecodeAuthChecks(
			domain.AuthCheckType(checkType.Int64),
			checkID.String,
			lastChallengedAt, lastFailedAt, verifiedAt, fc,
			json.RawMessage(nullJSONBytes(challengePayload)),
			json.RawMessage(nullJSONBytes(factorPayload)),
		)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		for _, checker := range checks {
			attempt.SetCheck(checker)
		}
	}
	if err := rows.Err(); err != nil {
		return wrapError(err)
	}
	if !found {
		return domain.ErrAuthAttemptNotFound()
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
	now := time.Now().UTC()
	var handedOffNano int64
	err := as.client.QueryRow(ctx, handoffAuthAttemptStmt,
		attempt.HandoffToken.TokenHash, now.UnixNano(), attempt.ProjectID, attempt.ID,
	).Scan(&handedOffNano)
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", wrapError(err))
	}
	handedOffAt := timeFromUnixNano(handedOffNano)
	attempt.HandedOffAt = &handedOffAt
	return nil
}

// SetAuthAttemptChallenge implements [service.AuthAttemptStatements].
func (as authAttemptStatements) SetAuthAttemptChallenge(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error {
	now := time.Now().UTC()
	payloadStr, err := authattempt.MarshalPayloadString(challenge.Payload())
	if err != nil {
		return fmt.Errorf("failed to marshal challenge payload: %w", err)
	}
	checkID := ""
	if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
		return err
	}
	var payloadArg any
	if payloadStr != nil {
		payloadArg = *payloadStr
	}
	var returnedID string
	if err := as.client.QueryRow(ctx, setAuthAttemptChallengeStmt,
		projectID, authAttemptID, checkID, int64(challenge.Type()), now.UnixNano(), payloadArg,
	).Scan(&returnedID); err != nil {
		return fmt.Errorf("failed to set challenge: %w", wrapError(err))
	}
	challenge.SetID(returnedID)
	challenge.SetLastChallengedAt(now)
	challenge.SetFailureCount(0)
	challenge.SetLastFailedAt(time.Time{})
	return nil
}

// SetAuthAttemptFactor implements [service.AuthAttemptStatements].
func (as authAttemptStatements) SetAuthAttemptFactor(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor) (string, error) {
	now := time.Now().UTC()
	payloadStr, err := authattempt.MarshalPayloadString(factor.Payload())
	if err != nil {
		return "", fmt.Errorf("failed to marshal factor payload: %w", err)
	}
	checkID := ""
	if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
		return "", err
	}
	var payloadArg any
	if payloadStr != nil {
		payloadArg = *payloadStr
	}
	var returnedID string
	if err := as.client.QueryRow(ctx, setAuthAttemptFactorStmt,
		projectID, authAttemptID, checkID, int64(factor.Type()), now.UnixNano(), payloadArg,
	).Scan(&returnedID); err != nil {
		return "", fmt.Errorf("failed to set factor: %w", wrapError(err))
	}
	factor.SetLastVerifiedAt(now)
	return returnedID, nil
}

// AuthAttemptChallengeSucceeded implements [service.AuthAttemptStatements].
func (as authAttemptStatements) AuthAttemptChallengeSucceeded(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor, challengeID string) error {
	now := time.Now().UTC()
	factorStr, err := authattempt.MarshalPayloadString(factor.Payload())
	if err != nil {
		return fmt.Errorf("failed to marshal factor payload: %w", err)
	}
	var factorArg any
	if factorStr != nil {
		factorArg = *factorStr
	}
	n, err := execAffected(ctx, as.client, authAttemptChallengeSucceededStmt,
		now.UnixNano(), factorArg, projectID, authAttemptID, int64(factor.Type()), challengeID)
	if err != nil {
		return fmt.Errorf("failed to set challenge succeeded: %w", err)
	}
	if n == 0 {
		return domain.ErrAuthAttemptStaleChallenge()
	}
	factor.SetLastVerifiedAt(now)
	return nil
}

// AuthAttemptChallengeFailed implements [service.AuthAttemptStatements].
func (as authAttemptStatements) AuthAttemptChallengeFailed(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error {
	now := time.Now().UTC()
	var (
		failureCount   int64
		lastFailedNano int64
	)
	err := as.client.QueryRow(ctx, authAttemptChallengeFailedStmt,
		now.UnixNano(), projectID, authAttemptID, int64(challenge.Type()), challenge.GetID(),
	).Scan(&failureCount, &lastFailedNano)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ErrAuthAttemptStaleChallenge()
		}
		return fmt.Errorf("failed to update challenge failed: %w", wrapError(err))
	}
	challenge.SetFailureCount(uint16(failureCount))
	challenge.SetLastFailedAt(timeFromUnixNano(lastFailedNano))
	return nil
}

// IssueSSOState implements [service.AuthAttemptStatements].
func (as authAttemptStatements) IssueSSOState(ctx context.Context, projectID, authAttemptID string, check *domain.SSOCallbackCheck) error {
	now := time.Now().UTC()
	payloadStr, err := authattempt.MarshalPayloadString(check.Pending)
	if err != nil {
		return fmt.Errorf("failed to marshal sso state payload: %w", err)
	}
	var payloadArg any
	if payloadStr != nil {
		payloadArg = *payloadStr
	}
	checkID := check.ID
	if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
		return err
	}
	var returnedID string
	if err := as.client.QueryRow(ctx, issueSSOStateStmt,
		projectID, authAttemptID, int64(domain.AuthCheckTypeSSOCallback), checkID, now.UnixNano(), payloadArg, check.StateHash,
	).Scan(&returnedID); err != nil {
		return fmt.Errorf("failed to issue sso state: %w", wrapError(err))
	}
	check.ID = returnedID
	check.AuthAttemptID = authAttemptID
	check.IssuedAt = now
	return nil
}

// ConsumeSSOState implements [service.AuthAttemptStatements].
func (as authAttemptStatements) ConsumeSSOState(ctx context.Context, projectID, stateHash string) (*domain.SSOCallbackCheck, error) {
	check := &domain.SSOCallbackCheck{StateHash: stateHash}
	var payload sql.NullString
	var createdNano int64
	var timeToLiveNano sql.NullInt64
	err := as.client.QueryRow(ctx, selectPendingSSOStateStmt,
		projectID, stateHash, int64(domain.AuthCheckTypeSSOCallback),
	).Scan(&check.ID, &check.AuthAttemptID, &payload, &createdNano, &timeToLiveNano)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrSSOStateInvalid()
		}
		return nil, fmt.Errorf("failed to read sso state: %w", wrapError(err))
	}
	if raw := nullJSONBytes(payload); len(raw) > 0 {
		if err := json.Unmarshal(raw, &check.Pending); err != nil {
			return nil, fmt.Errorf("failed to unmarshal sso state payload: %w", err)
		}
	}
	attempt := domain.AuthAttempt{CreatedAt: timeFromUnixNano(createdNano)}
	if timeToLiveNano.Valid {
		ttl := time.Duration(timeToLiveNano.Int64)
		attempt.TimeToLive = &ttl
	}
	// The guarded update is the single-use gate: a racing consumer that
	// already cleared the challenge state leaves zero rows for this one. The
	// clock is read after the burn, so a consume that stalls on the update
	// cannot hand back a state that has meanwhile expired.
	n, err := execAffected(ctx, as.client, consumeSSOStateStmt,
		projectID, stateHash, int64(domain.AuthCheckTypeSSOCallback))
	if err != nil {
		return nil, fmt.Errorf("failed to consume sso state: %w", err)
	}
	if n == 0 || attempt.IsExpired() {
		return nil, domain.ErrSSOStateInvalid()
	}
	return check, nil
}

// SetSSOCallbackResult implements [service.AuthAttemptStatements].
func (as authAttemptStatements) SetSSOCallbackResult(ctx context.Context, projectID, stateHash string, result *domain.SSOCallbackResult) error {
	payloadStr, err := authattempt.MarshalPayloadString(result)
	if err != nil {
		return fmt.Errorf("failed to marshal sso callback result: %w", err)
	}
	var payloadArg any
	if payloadStr != nil {
		payloadArg = *payloadStr
	}
	n, err := execAffected(ctx, as.client, setSSOCallbackResultStmt,
		payloadArg, projectID, stateHash, int64(domain.AuthCheckTypeSSOCallback))
	if err != nil {
		return fmt.Errorf("failed to set sso callback result: %w", err)
	}
	if n == 0 {
		return domain.ErrSSOStateInvalid()
	}
	return nil
}

var _ service.AuthAttemptStatements = (*authAttemptStatements)(nil)
