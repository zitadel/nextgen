package spanner

import (
	"context"
	"errors"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	getSignupChallengeStmt            = `SELECT project_id, flow_id, id, expires_at, payload FROM signup_challenges WHERE project_id = @p1 AND flow_id = @p2`
	createSignupChallengeStmt         = `INSERT INTO signup_challenges (project_id, flow_id, id, expires_at, payload) VALUES (@p1, @p2, @p3, @p4, @p5)`
	consumeSignupChallengeStmt        = `DELETE FROM signup_challenges WHERE project_id = @p1 AND flow_id = @p2 AND id = @p3 AND expires_at > @p4`
	deleteExpiredSignupChallengesStmt = `DELETE FROM signup_challenges WHERE project_id = @p1 AND expires_at <= @p2`
	getSignupLimitsStmt               = `SELECT project_id, window_start, issued, verified FROM signup_limits WHERE project_id = @p1`
	insertSignupLimitsStmt            = `INSERT INTO signup_limits (project_id, window_start, issued, verified) VALUES (@p1, @p2, @p3, @p4)`
	updateSignupLimitsStmt            = `UPDATE signup_limits SET window_start = @p1, issued = @p2, verified = @p3 WHERE project_id = @p4`
)

type signupProtectionStatements struct{ statement }

func newSignupProtectionStatements(db queryExecutor) signupProtectionStatements {
	return signupProtectionStatements{statement: statement{db: db}}
}
func (s signupProtectionStatements) GetSignupChallenge(ctx context.Context, projectID, flowID string) (*domain.SignupChallengeRecord, error) {
	var record domain.SignupChallengeRecord
	err := s.db.Query(ctx, buildStatement(getSignupChallengeStmt, projectID, flowID).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&record.ProjectID, &record.FlowID, &record.ID, &record.ExpiresAt, &record.Payload)
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
func (s signupProtectionStatements) GetSignupLimits(ctx context.Context, projectID string) (*domain.SignupLimits, error) {
	var record domain.SignupLimits
	err := s.db.Query(ctx, buildStatement(getSignupLimitsStmt, projectID).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&record.ProjectID, &record.WindowStart, &record.Issued, &record.Verified)
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
	_, err := s.db.Update(ctx, buildStatement(createSignupChallengeStmt, r.ProjectID, r.FlowID, r.ID, r.ExpiresAt, r.Payload).statement())
	return wrapError(err)
}
func (s signupProtectionStatements) ConsumeSignupChallenge(ctx context.Context, projectID, flowID, id string, now int64) (bool, error) {
	n, err := s.db.Update(ctx, buildStatement(consumeSignupChallengeStmt, projectID, flowID, id, now).statement())
	return n == 1, wrapError(err)
}
func (s signupProtectionStatements) DeleteExpiredSignupChallenges(ctx context.Context, projectID string, now int64) error {
	_, err := s.db.Update(ctx, buildStatement(deleteExpiredSignupChallengesStmt, projectID, now).statement())
	return wrapError(err)
}
func (s signupProtectionStatements) InsertSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := s.db.Update(ctx, buildStatement(insertSignupLimitsStmt, r.ProjectID, r.WindowStart, r.Issued, r.Verified).statement())
	return wrapError(err)
}
func (s signupProtectionStatements) UpdateSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := s.db.Update(ctx, buildStatement(updateSignupLimitsStmt, r.WindowStart, r.Issued, r.Verified, r.ProjectID).statement())
	return wrapError(err)
}
