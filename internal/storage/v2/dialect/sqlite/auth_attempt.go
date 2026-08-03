package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/authattempt"
	v2session "github.com/zitadel/nextgen/internal/storage/v2/session"
)

const (
	authAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
		` aa.required_checks, aa.created_at, c.type, aa.time_to_live,` +
		` c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
		` FROM auth_attempts aa` +
		` LEFT JOIN checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`

	createAuthAttemptStmt = `INSERT INTO auth_attempts (project_id, required_checks, time_to_live, session_id, created_at)
VALUES (?, ?, ?, ?, ?) RETURNING id`

	createAuthCheckStmt = `INSERT INTO checks (project_id, auth_attempt_id, type, last_challenged_at, last_verified_at, challenge_payload, factor_payload, failure_count)
VALUES (?, ?, ?, ?, ?, ?, ?, 0) RETURNING id`

	deleteAuthAttemptByIDStmt = `DELETE FROM auth_attempts WHERE project_id = ? AND id = ?`

	handoffAuthAttemptStmt = `UPDATE auth_attempts SET handoff_token = ?, handed_off_at = ? WHERE project_id = ? AND id = ? RETURNING handed_off_at`

	setAuthAttemptChallengeStmt = `INSERT INTO checks (project_id, auth_attempt_id, type, last_challenged_at, challenge_payload, failure_count, last_failed_at)` +
		` VALUES (?, ?, ?, ?, ?, 0, NULL) ON CONFLICT (project_id, auth_attempt_id, type)` +
		` DO UPDATE SET last_challenged_at = EXCLUDED.last_challenged_at, challenge_payload = EXCLUDED.challenge_payload, failure_count = 0, last_failed_at = NULL` +
		` RETURNING id`

	authAttemptChallengeSucceededStmt = `UPDATE checks SET last_verified_at = ?, factor_payload = ?, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0` +
		` WHERE project_id = ? AND auth_attempt_id = ? AND type = ? AND id = ?`

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
		id, err := parseIdentity(*attempt.SessionID)
		if err != nil {
			return err
		}
		sessionID = id
	}

	return withTransaction(ctx, as.client, func(ctx context.Context, tx queryExecutor) error {
		var attemptID int64
		if err := tx.QueryRow(ctx, createAuthAttemptStmt,
			attempt.ProjectID, string(req), ttlNanos, sessionID, now.UnixNano(),
		).Scan(&attemptID); err != nil {
			return fmt.Errorf("failed to create auth attempt: %w", wrapError(err))
		}
		attempt.ID = strconv.FormatInt(attemptID, 10)
		attempt.CreatedAt = now

		for _, check := range attempt.Checks {
			challenge, isChallenge := check.(domain.AuthChallenge)
			factor, isFactor := check.(domain.AuthFactor)

			var challengedAtNano, verifiedAtNano any
			var challengePayload, factorPayload any

			if isChallenge {
				challengedAtNano = now.UnixNano()
				challenge.SetLastChallengedAt(now)
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

			var checkID int64
			if err := tx.QueryRow(ctx, createAuthCheckStmt,
				attempt.ProjectID, attemptID, int64(check.Type()),
				challengedAtNano, verifiedAtNano, challengePayload, factorPayload,
			).Scan(&checkID); err != nil {
				return fmt.Errorf("failed to create auth attempt check: %w", wrapError(err))
			}
			if isChallenge {
				challenge.SetID(strconv.FormatInt(checkID, 10))
			}
		}
		return nil
	})
}

// GetAuthAttemptByID implements [service.AuthAttemptStatements].
func (as authAttemptStatements) GetAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) (*domain.AuthAttempt, error) {
	id, err := parseIdentity(authAttemptID)
	if err != nil {
		return nil, err
	}
	var c statementCompiler
	c.WriteString(authAttemptGetSelect)
	c.WriteString(" WHERE aa.project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND aa.id = ")
	c.WriteArg(id)
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
			attemptID          int64
			handoffToken       []byte
			handedOffAtNano    sql.NullInt64
			sessionIDVal       sql.NullInt64
			requiredChecksJSON string
			checkType          sql.NullInt64
			timeToLiveNano     sql.NullInt64
			checkID            sql.NullInt64
			lastChallengedNano sql.NullInt64
			verifiedAtNano     sql.NullInt64
			lastFailedAtNano   sql.NullInt64
			failureCount       sql.NullInt64
			challengePayload   sql.NullString
			factorPayload      sql.NullString
			createdNano        int64
		)
		if err := rows.Scan(
			&attempt.ProjectID, &attemptID, &handoffToken, &handedOffAtNano, &sessionIDVal,
			&requiredChecksJSON, &createdNano, &checkType, &timeToLiveNano,
			&checkID, &lastChallengedNano, &verifiedAtNano, &lastFailedAtNano, &failureCount,
			&challengePayload, &factorPayload,
		); err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		attempt.ID = strconv.FormatInt(attemptID, 10)
		attempt.CreatedAt = timeFromUnixNano(createdNano)

		if attempt.RequiredChecks == nil {
			var reqInts []int64
			if err := json.Unmarshal([]byte(requiredChecksJSON), &reqInts); err != nil {
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
			s := strconv.FormatInt(sessionIDVal.Int64, 10)
			attempt.SessionID = &s
		}
		if timeToLiveNano.Valid {
			d := time.Duration(timeToLiveNano.Int64)
			attempt.TimeToLive = &d
		}

		if !checkType.Valid || !checkID.Valid {
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
			strconv.FormatInt(checkID.Int64, 10),
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
	id, err := parseIdentity(authAttemptID)
	if err != nil {
		return err
	}
	_, err = as.client.Exec(ctx, deleteAuthAttemptByIDStmt, projectID, id)
	return wrapError(err)
}

// HandoffAuthAttempt implements [service.AuthAttemptStatements].
func (as authAttemptStatements) HandoffAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	id, err := parseIdentity(attempt.ID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	var handedOffNano int64
	err = as.client.QueryRow(ctx, handoffAuthAttemptStmt,
		attempt.HandoffToken.TokenHash, now.UnixNano(), attempt.ProjectID, id,
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
	id, err := parseIdentity(authAttemptID)
	if err != nil {
		return err
	}
	var payloadArg any
	if payloadStr != nil {
		payloadArg = *payloadStr
	}
	var checkID int64
	if err := as.client.QueryRow(ctx, setAuthAttemptChallengeStmt,
		projectID, id, int64(challenge.Type()), now.UnixNano(), payloadArg,
	).Scan(&checkID); err != nil {
		return fmt.Errorf("failed to set challenge: %w", wrapError(err))
	}
	challenge.SetID(strconv.FormatInt(checkID, 10))
	challenge.SetLastChallengedAt(now)
	challenge.SetFailureCount(0)
	challenge.SetLastFailedAt(time.Time{})
	return nil
}

// AuthAttemptChallengeSucceeded implements [service.AuthAttemptStatements].
func (as authAttemptStatements) AuthAttemptChallengeSucceeded(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor, challengeID string) error {
	now := time.Now().UTC()
	factorStr, err := authattempt.MarshalPayloadString(factor.Payload())
	if err != nil {
		return fmt.Errorf("failed to marshal factor payload: %w", err)
	}
	attemptID, err := parseIdentity(authAttemptID)
	if err != nil {
		return err
	}
	checkID, err := parseIdentity(challengeID)
	if err != nil {
		return err
	}
	var factorArg any
	if factorStr != nil {
		factorArg = *factorStr
	}
	n, err := execAffected(ctx, as.client, authAttemptChallengeSucceededStmt,
		now.UnixNano(), factorArg, projectID, attemptID, int64(factor.Type()), checkID)
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
	attemptID, err := parseIdentity(authAttemptID)
	if err != nil {
		return err
	}
	checkID, err := parseIdentity(challenge.GetID())
	if err != nil {
		return err
	}
	var (
		failureCount   int64
		lastFailedNano int64
	)
	err = as.client.QueryRow(ctx, authAttemptChallengeFailedStmt,
		now.UnixNano(), projectID, attemptID, int64(challenge.Type()), checkID,
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

var _ service.AuthAttemptStatements = (*authAttemptStatements)(nil)
