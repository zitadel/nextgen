package spanner

import (
	"context"
	"errors"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	getSignupChallengeStmt            = `SELECT project_id, flow_id, id, expires_at, payload, public FROM signup_challenges WHERE project_id = @p1 AND flow_id = @p2`
	createSignupChallengeStmt         = `INSERT OR UPDATE INTO signup_challenges (project_id, flow_id, id, expires_at, payload, public) VALUES (@p1, @p2, @p3, @p4, @p5, @p6)`
	consumeSignupChallengeStmt        = `DELETE FROM signup_challenges WHERE project_id = @p1 AND flow_id = @p2 AND id = @p3 AND expires_at > @p4`
	expiredSignupChallengesQuery      = `SELECT flow_id FROM signup_challenges@{FORCE_INDEX=idx_signup_challenges_project_expires_at} WHERE project_id = @p1 AND expires_at <= @p2 LIMIT @p3`
	deleteExpiredSignupChallengesStmt = `DELETE FROM signup_challenges WHERE project_id = @p1 AND expires_at <= @p2 AND flow_id IN UNNEST(@p3)`
	expiredSignupLimitsQuery          = `SELECT flow_id FROM signup_limits@{FORCE_INDEX=idx_signup_limits_project_window_start} WHERE project_id = @p1 AND window_start <= @p2 LIMIT @p3`
	deleteExpiredSignupLimitsStmt     = `DELETE FROM signup_limits WHERE project_id = @p1 AND window_start <= @p2 AND flow_id IN UNNEST(@p3)`
	getSignupLimitsStmt               = `SELECT project_id, flow_id, window_start, issued, verified FROM signup_limits WHERE project_id = @p1 AND flow_id = @p2 FOR UPDATE`
	insertSignupLimitsStmt            = `INSERT OR IGNORE INTO signup_limits (project_id, flow_id, window_start, issued, verified) VALUES (@p1, @p2, @p3, @p4, @p5)`
	updateSignupLimitsStmt            = `UPDATE signup_limits SET window_start = @p1, issued = @p2, verified = @p3 WHERE project_id = @p4 AND flow_id = @p5`
)

type signupProtectionStatements struct{ statement }

func newSignupProtectionStatements(db queryExecutor) signupProtectionStatements {
	return signupProtectionStatements{statement: statement{db: db}}
}
func (s signupProtectionStatements) GetSignupChallenge(ctx context.Context, projectID, flowID string) (*domain.SignupChallengeRecord, error) {
	var record domain.SignupChallengeRecord
	err := s.db.Query(ctx, buildStatement(getSignupChallengeStmt, projectID, flowID).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&record.ProjectID, &record.FlowID, &record.ID, &record.ExpiresAt, &record.Payload, &record.Public)
		})
		return err
	})
	if errors.Is(err, new(database.NoRowFoundError)) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}
func (s signupProtectionStatements) LockSignupLimits(ctx context.Context, projectID, flowID string) (*domain.SignupLimits, error) {
	var record domain.SignupLimits
	err := s.db.Query(ctx, buildStatement(getSignupLimitsStmt, projectID, flowID).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&record.ProjectID, &record.FlowID, &record.WindowStart, &record.Issued, &record.Verified)
		})
		return err
	})
	if errors.Is(err, new(database.NoRowFoundError)) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}
func (s signupProtectionStatements) CreateSignupChallenge(ctx context.Context, r *domain.SignupChallengeRecord) error {
	_, err := s.db.Update(ctx, buildStatement(createSignupChallengeStmt, r.ProjectID, r.FlowID, r.ID, r.ExpiresAt, r.Payload, r.Public).statement())
	return wrapError(err)
}
func (s signupProtectionStatements) ConsumeSignupChallenge(ctx context.Context, projectID, flowID, id string, now int64) (bool, error) {
	n, err := s.db.Update(ctx, buildStatement(consumeSignupChallengeStmt, projectID, flowID, id, now).statement())
	return n == 1, wrapError(err)
}
func (s signupProtectionStatements) DeleteExpiredSignupProtection(ctx context.Context, projectID string, now int64, limit int) error {
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		if err := deleteExpiredSignupBatch(ctx, tx, expiredSignupChallengesQuery, deleteExpiredSignupChallengesStmt, projectID, now, limit); err != nil {
			return err
		}
		// Retain inactive counters for an hour, well beyond their one-minute window.
		return deleteExpiredSignupBatch(ctx, tx, expiredSignupLimitsQuery, deleteExpiredSignupLimitsStmt, projectID, now-3600, limit)
	})
}

// deleteExpiredSignupBatch deletes at most limit expired rows: a transaction
// past Spanner's mutation limit fails whole, so one unbounded delete after a
// burst would fail on every later sweep too. The delete repeats the cutoff, so
// a row refreshed since the read stays.
func deleteExpiredSignupBatch(ctx context.Context, tx queryExecutor, query, stmt, projectID string, cutoff int64, limit int) error {
	var flowIDs []string
	err := tx.Query(ctx, buildStatement(query, projectID, cutoff, int64(limit)).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		flowIDs, qErr = collectRows(iter, func(row *spanner.Row) (string, error) {
			var flowID string
			return flowID, row.Columns(&flowID)
		})
		return qErr
	})
	if err != nil || len(flowIDs) == 0 {
		return err
	}
	_, err = tx.Update(ctx, buildStatement(stmt, projectID, cutoff, flowIDs).statement())
	return wrapError(err)
}
func (s signupProtectionStatements) InsertSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := s.db.Update(ctx, buildStatement(insertSignupLimitsStmt, r.ProjectID, r.FlowID, r.WindowStart, r.Issued, r.Verified).statement())
	return wrapError(err)
}
func (s signupProtectionStatements) UpdateSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := s.db.Update(ctx, buildStatement(updateSignupLimitsStmt, r.WindowStart, r.Issued, r.Verified, r.ProjectID, r.FlowID).statement())
	return wrapError(err)
}
