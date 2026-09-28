package spanner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authattempt"
	"github.com/zitadel/nextgen/internal/storage/session"
)

const (
	authAttemptGetSelect = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,` +
		` aa.required_checks, aa.created_at, c.type, aa.time_to_live, aa.internal,` +
		` c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
		` FROM auth_attempts aa` +
		` LEFT JOIN checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id`
	createAuthAttemptStmt     = `INSERT INTO auth_attempts (project_id, id, required_checks, time_to_live, session_id, created_at, internal) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7)`
	createAuthCheckStmt       = `INSERT INTO checks (project_id, auth_attempt_id, id, type, last_challenged_at, last_verified_at, challenge_payload, factor_payload, failure_count) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, 0)`
	deleteAuthAttemptByIDStmt = `DELETE FROM auth_attempts WHERE project_id = @p1 AND id = @p2`
	handoffAuthAttemptStmt    = `UPDATE auth_attempts SET handoff_token = @p1, handed_off_at = @p2 WHERE project_id = @p3 AND id = @p4 THEN RETURN handed_off_at`
	// Spanner rejects a NULL_FILTERED unique index as ON CONFLICT arbiter
	// ("Unimplemented"), so the challenge upsert is update-then-insert inside
	// withTransaction instead of INSERT ... ON CONFLICT.
	updateAuthAttemptChallengeStmt = `UPDATE checks SET last_challenged_at = @p4, challenge_payload = @p5, failure_count = 0, last_failed_at = NULL` +
		` WHERE project_id = @p1 AND auth_attempt_id = @p2 AND type = @p3` +
		` THEN RETURN id`
	insertAuthAttemptChallengeStmt = `INSERT INTO checks (project_id, auth_attempt_id, type, id, last_challenged_at, challenge_payload, failure_count, last_failed_at)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, 0, NULL)` +
		` THEN RETURN id`
	updateAuthAttemptFactorStmt = `UPDATE checks SET last_verified_at = @p4, factor_payload = @p5, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0, last_failed_at = NULL` +
		` WHERE project_id = @p1 AND auth_attempt_id = @p2 AND type = @p3` +
		` THEN RETURN id`
	insertAuthAttemptFactorStmt = `INSERT INTO checks (project_id, auth_attempt_id, type, id, last_verified_at, factor_payload, failure_count)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, 0)` +
		` THEN RETURN id`
	authAttemptChallengeSucceededStmt = `UPDATE checks SET last_verified_at = @p1, factor_payload = @p2, challenge_payload = NULL, last_challenged_at = NULL, failure_count = 0` +
		` WHERE project_id = @p3 AND auth_attempt_id = @p4 AND type = @p5 AND id = @p6`
	authAttemptChallengeFailedStmt = `UPDATE checks SET last_failed_at = @p1, failure_count = failure_count + 1` +
		` WHERE project_id = @p2 AND auth_attempt_id = @p3 AND type = @p4 AND id = @p5` +
		` THEN RETURN failure_count, last_failed_at`
)

type authAttemptStatements struct{ statement }

// encodeSpannerJSONPtr binds an optional pre-marshalled JSON payload as
// spanner.NullJSON (nil means SQL NULL); plain strings cannot be bound to
// Spanner JSON columns.
func encodeSpannerJSONPtr(s *string) any {
	if s == nil {
		return spanner.NullJSON{}
	}
	return encodeSpannerJSON([]byte(*s))
}

func newAuthAttemptStatements(db queryExecutor) authAttemptStatements {
	return authAttemptStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateAuthAttempt implements [service.AuthAttemptStatements].
func (as authAttemptStatements) CreateAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error {
	if err := ensureManagedID(&attempt.ID, domain.PrefixAuthAttempt); err != nil {
		return err
	}
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

	return withTransaction(ctx, as.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createAuthAttemptStmt, attempt.ProjectID, attempt.ID, req, ttlNanos, authattempt.SessionIDArg(attempt.SessionID), now, attempt.Internal).statement()
		if _, err := tx.Update(ctx, stmt); err != nil {
			return fmt.Errorf("failed to create auth attempt: %w", err)
		}
		attempt.CreatedAt = now

		for _, check := range attempt.Checks {
			challenge, isChallenge := check.(domain.AuthChallenge)
			factor, isFactor := check.(domain.AuthFactor)

			var challengedAt, verifiedAt *time.Time
			var challengePayload, factorPayload *string
			var err error

			checkID := ""
			if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
				return err
			}

			if isChallenge {
				challengedAt = &now
				challenge.SetLastChallengedAt(now)
				challenge.SetID(checkID)
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
				attempt.ProjectID, attempt.ID, checkID, int64(check.Type()),
				challengedAt, verifiedAt, encodeSpannerJSONPtr(challengePayload), encodeSpannerJSONPtr(factorPayload)).statement()
			if _, err := tx.Update(ctx, checkStmt); err != nil {
				return fmt.Errorf("failed to create auth attempt check: %w", err)
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
			handoffToken     []byte
			handedOffAt      spanner.NullTime
			sessionID        spanner.NullString
			requiredChecks   []spanner.NullInt64
			checkType        spanner.NullInt64
			timeToLiveNanos  spanner.NullInt64
			challengeID      spanner.NullString
			lastChallengedAt spanner.NullTime
			verifiedAt       spanner.NullTime
			lastFailedAt     spanner.NullTime
			failureCount     spanner.NullInt64
			challenge        spanner.NullJSON
			factor           spanner.NullJSON
		)
		if err := row.Columns(
			&attempt.ProjectID, &attempt.ID, &handoffToken, &handedOffAt, &sessionID,
			&requiredChecks, &attempt.CreatedAt, &checkType, &timeToLiveNanos, &attempt.Internal,
			&challengeID, &lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor,
		); err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}

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
			s := sessionID.StringVal
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
			challengeIDV      string
			lastChallengedAtV time.Time
			lastFailedAtV     time.Time
			verifiedAtV       time.Time
			failureCountV     uint16
		)
		if challengeID.Valid {
			challengeIDV = challengeID.StringVal
		}
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
		checks, err := session.DecodeAuthChecks(
			domain.AuthCheckType(checkType.Int64),
			challengeIDV,
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
	stmt := buildStatement(deleteAuthAttemptByIDStmt, projectID, authAttemptID).statement()
	_, err := as.db.Update(ctx, stmt)
	return err
}

// HandoffAuthAttempt implements [service.AuthAttemptStatements].
func (as authAttemptStatements) HandoffAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil {
		return fmt.Errorf("failed to handoff auth attempt: handoff token is required")
	}
	now := time.Now().UTC()
	stmt := buildStatement(handoffAuthAttemptStmt, attempt.HandoffToken.TokenHash, now, attempt.ProjectID, attempt.ID).statement()
	var handedOffAt time.Time
	err := as.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&handedOffAt)
		})
		return err
	})
	if err != nil {
		return fmt.Errorf("failed to handoff auth attempt: %w", err)
	}
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

	var returnedID string
	scanCheckID := func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&returnedID)
		})
		return err
	}
	err = withTransaction(ctx, as.db, func(ctx context.Context, tx queryExecutor) error {
		update := buildStatement(updateAuthAttemptChallengeStmt,
			projectID, authAttemptID, int64(challenge.Type()), now, encodeSpannerJSONPtr(payloadStr)).statement()
		err := tx.Write(ctx, update, scanCheckID)
		if err == nil {
			return nil
		}
		var noRow *database.NoRowFoundError
		if !errors.As(err, &noRow) {
			return err
		}
		checkID := ""
		if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
			return err
		}
		insert := buildStatement(insertAuthAttemptChallengeStmt,
			projectID, authAttemptID, int64(challenge.Type()), checkID, now, encodeSpannerJSONPtr(payloadStr)).statement()
		return tx.Write(ctx, insert, scanCheckID)
	})
	if err != nil {
		return fmt.Errorf("failed to set challenge: %w", err)
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

	var returnedID string
	scanCheckID := func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&returnedID)
		})
		return err
	}
	err = withTransaction(ctx, as.db, func(ctx context.Context, tx queryExecutor) error {
		update := buildStatement(updateAuthAttemptFactorStmt,
			projectID, authAttemptID, int64(factor.Type()), now, encodeSpannerJSONPtr(payloadStr)).statement()
		err := tx.Write(ctx, update, scanCheckID)
		if err == nil {
			return nil
		}
		var noRow *database.NoRowFoundError
		if !errors.As(err, &noRow) {
			return err
		}
		checkID := ""
		if err := ensureManagedID(&checkID, domain.PrefixChallenge); err != nil {
			return err
		}
		insert := buildStatement(insertAuthAttemptFactorStmt,
			projectID, authAttemptID, int64(factor.Type()), checkID, now, encodeSpannerJSONPtr(payloadStr)).statement()
		return tx.Write(ctx, insert, scanCheckID)
	})
	if err != nil {
		return "", fmt.Errorf("failed to set factor: %w", err)
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

	stmt := buildStatement(authAttemptChallengeSucceededStmt,
		now, encodeSpannerJSONPtr(factorStr), projectID, authAttemptID, int64(factor.Type()), challengeID).statement()
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

	stmt := buildStatement(authAttemptChallengeFailedStmt,
		now, projectID, authAttemptID, int64(challenge.Type()), challenge.GetID()).statement()
	var failureCount int64
	var lastFailedAt time.Time
	err := as.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&failureCount, &lastFailedAt)
		})
		return err
	})
	if err != nil {
		var noRow *database.NoRowFoundError
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
