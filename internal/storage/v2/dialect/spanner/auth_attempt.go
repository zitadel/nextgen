package spanner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/authattempt"
	v2session "github.com/zitadel/nextgen/internal/storage/v2/session"
)

const (
	authAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
		` aa.required_checks, aa.created_at, c.type, aa.time_to_live,` +
		` c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
		` FROM auth_attempts aa` +
		` LEFT JOIN checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`
	createAuthAttemptStmt       = `INSERT INTO auth_attempts (project_id, required_checks, time_to_live, session_id, created_at) VALUES (@p1, @p2, @p3, @p4, @p5) THEN RETURN id`
	createAuthCheckStmt         = `INSERT INTO checks (project_id, auth_attempt_id, type, last_challenged_at, last_verified_at, challenge_payload, factor_payload, failure_count) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, 0) THEN RETURN id`
	deleteAuthAttemptByIDStmt   = `DELETE FROM auth_attempts WHERE project_id = @p1 AND id = @p2`
	handoffAuthAttemptStmt      = `UPDATE auth_attempts SET handoff_token = @p1, handed_off_at = @p2 WHERE project_id = @p3 AND id = @p4`
	setAuthAttemptChallengeStmt = `INSERT INTO checks (project_id, auth_attempt_id, type, last_challenged_at, challenge_payload, failure_count, last_failed_at)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, 0, NULL) ON CONFLICT (project_id, auth_attempt_id, type)` +
		` DO UPDATE SET last_challenged_at = EXCLUDED.last_challenged_at, challenge_payload = EXCLUDED.challenge_payload, failure_count = 0, last_failed_at = NULL` +
		` THEN RETURN id`
	authAttemptChallengeSucceededStmt = `UPDATE checks SET last_verified_at = @p1, factor_payload = @p2, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0` +
		` WHERE project_id = @p3 AND auth_attempt_id = @p4 AND type = @p5 AND id = @p6`
	authAttemptChallengeFailedStmt = `UPDATE checks SET last_failed_at = @p1, failure_count = failure_count + 1` +
		` WHERE project_id = @p2 AND auth_attempt_id = @p3 AND type = @p4 AND id = @p5` +
		` THEN RETURN failure_count, last_failed_at`
)

type authAttemptStatements struct{ statement }

func newAuthAttemptStatements(db queryExecutor) authAttemptStatements {
	return authAttemptStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateAuthAttempt implements [service.AuthAttemptStatements].
func (as authAttemptStatements) CreateAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error {
	now := time.Now().UTC()

	req := make([]int64, len(attempt.RequiredChecks))
	for i, c := range attempt.RequiredChecks {
		req[i] = int64(c)
	}
	var ttlNanos *int64
	if attempt.TimeToLive != nil {
		n := attempt.TimeToLive.Nanoseconds()
		ttlNanos = &n
	}

	var sessionID any
	if attempt.SessionID != nil {
		id, err := parseIdentity(*attempt.SessionID)
		if err != nil {
			return err
		}
		sessionID = id
	}

	return withTransaction(ctx, as.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createAuthAttemptStmt, attempt.ProjectID, req, ttlNanos, sessionID, now).statement()
		var attemptID storagedb.Identity
		err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				return struct{}{}, row.Columns(&attemptID)
			})
			return err
		})
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
				challengedAt = &now
				challenge.SetLastChallengedAt(now)
				challengePayload, err = authattempt.MarshalPayloadString(challenge.Payload())
				if err != nil {
					return fmt.Errorf("failed to marshal challenge payload: %w", err)
				}
			}
			if isFactor {
				if !isChallenge {
					verifiedAt = &now
					factor.SetLastVerifiedAt(now)
				}
				factorPayload, err = authattempt.MarshalPayloadString(factor.Payload())
				if err != nil {
					return fmt.Errorf("failed to marshal factor payload: %w", err)
				}
			}

			checkStmt := buildStatement(createAuthCheckStmt,
				attempt.ProjectID, storagedb.Identity(attempt.ID), int64(check.Type()),
				challengedAt, verifiedAt, challengePayload, factorPayload).statement()
			var checkID storagedb.Identity
			err = tx.Write(ctx, checkStmt, func(iter *spanner.RowIterator) error {
				_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
					return struct{}{}, row.Columns(&checkID)
				})
				return err
			})
			if err != nil {
				return fmt.Errorf("failed to create auth attempt check: %w", err)
			}
			if isChallenge {
				challenge.SetID(checkID.String())
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
	return as.get(ctx, authAttemptGetSelect+` WHERE aa.project_id = @p1 AND aa.id = @p2`, projectID, id)
}

// GetAuthAttemptByHandoffToken implements [service.AuthAttemptStatements].
func (as authAttemptStatements) GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffToken []byte) (*domain.AuthAttempt, error) {
	return as.get(ctx, authAttemptGetSelect+` WHERE aa.project_id = @p1 AND aa.handoff_token = @p2`, projectID, handoffToken)
}

func (as authAttemptStatements) get(ctx context.Context, query string, args ...any) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	stmt := buildStatement(query, args...).statement()
	err := as.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		return as.scan(iter, attempt)
	})
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

func (as authAttemptStatements) scan(iter *spanner.RowIterator, attempt *domain.AuthAttempt) error {
	var found bool
	err := iter.Do(func(row *spanner.Row) error {
		found = true
		var (
			attemptID        storagedb.Identity
			handoffToken     []byte
			handedOffAt      spanner.NullTime
			sessionID        spanner.NullInt64
			requiredChecks   []spanner.NullInt64
			checkType        spanner.NullInt64
			timeToLiveNanos  spanner.NullInt64
			challengeID      storagedb.Identity
			lastChallengedAt spanner.NullTime
			verifiedAt       spanner.NullTime
			lastFailedAt     spanner.NullTime
			failureCount     spanner.NullInt64
			challenge        spanner.NullJSON
			factor           spanner.NullJSON
		)
		if err := row.Columns(
			&attempt.ProjectID, &attemptID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &checkType, &timeToLiveNanos,
			&challengeID, &lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor,
		); err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		attempt.ID = attemptID.String()

		attempt.RequiredChecks = make([]domain.AuthCheckType, len(requiredChecks))
		for i, c := range requiredChecks {
			attempt.RequiredChecks[i] = domain.AuthCheckType(c.Int64)
		}
		if len(handoffToken) > 0 {
			attempt.HandoffToken = &domain.HandoffToken{TokenHash: handoffToken}
		}
		if handedOffAt.Valid {
			t := handedOffAt.Time
			attempt.HandedOffAt = &t
		}
		if sessionID.Valid {
			s := strconv.FormatInt(sessionID.Int64, 10)
			attempt.SessionID = &s
		}
		if timeToLiveNanos.Valid {
			d := time.Duration(timeToLiveNanos.Int64)
			attempt.TimeToLive = &d
		}

		if !checkType.Valid {
			return nil
		}
		var (
			lastChallengedAtV time.Time
			lastFailedAtV     time.Time
			verifiedAtV       time.Time
			failureCountV     uint16
		)
		if lastChallengedAt.Valid {
			lastChallengedAtV = lastChallengedAt.Time
		}
		if lastFailedAt.Valid {
			lastFailedAtV = lastFailedAt.Time
		}
		if verifiedAt.Valid {
			verifiedAtV = verifiedAt.Time
		}
		if failureCount.Valid {
			failureCountV = uint16(failureCount.Int64)
		}
		checks, err := v2session.DecodeAuthChecks(
			domain.AuthCheckType(checkType.Int64),
			challengeID.String(),
			lastChallengedAtV, lastFailedAtV, verifiedAtV, failureCountV,
			json.RawMessage(nullJSONBytes(challenge)),
			json.RawMessage(nullJSONBytes(factor)),
		)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		for _, checker := range checks {
			attempt.SetCheck(checker)
		}
		return nil
	})
	if err != nil {
		return err
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
	stmt := buildStatement(deleteAuthAttemptByIDStmt, projectID, id).statement()
	_, err = as.db.Update(ctx, stmt)
	return err
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
	stmt := buildStatement(handoffAuthAttemptStmt, attempt.HandoffToken.TokenHash, now, attempt.ProjectID, id).statement()
	_, err = as.db.Update(ctx, stmt)
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", err)
	}
	attempt.HandedOffAt = &now
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

	stmt := buildStatement(setAuthAttemptChallengeStmt,
		projectID, id, int64(challenge.Type()), now, payloadStr).statement()
	var checkID storagedb.Identity
	err = as.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&checkID)
		})
		return err
	})
	if err != nil {
		return fmt.Errorf("failed to set challenge: %w", err)
	}
	challenge.SetID(checkID.String())
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

	stmt := buildStatement(authAttemptChallengeSucceededStmt,
		now, factorStr, projectID, attemptID, int64(factor.Type()), checkID).statement()
	n, err := as.db.Update(ctx, stmt)
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

	stmt := buildStatement(authAttemptChallengeFailedStmt,
		now, projectID, attemptID, int64(challenge.Type()), checkID).statement()
	var failureCount int64
	var lastFailedAt time.Time
	err = as.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&failureCount, &lastFailedAt)
		})
		return err
	})
	if err != nil {
		var noRow *storagedb.NoRowFoundError
		if errors.As(err, &noRow) {
			return domain.ErrAuthAttemptStaleChallenge()
		}
		return fmt.Errorf("failed to update challenge failed: %w", err)
	}
	challenge.SetFailureCount(uint16(failureCount))
	challenge.SetLastFailedAt(lastFailedAt)
	return nil
}

var _ service.AuthAttemptStatements = (*authAttemptStatements)(nil)
