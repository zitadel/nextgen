package sqlite

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	getSignupChallengeStmt            = `SELECT project_id, flow_id, id, expires_at, payload FROM signup_challenges WHERE project_id = ? AND flow_id = ?`
	createSignupChallengeStmt         = `INSERT INTO signup_challenges (project_id, flow_id, id, expires_at, payload) VALUES (?, ?, ?, ?, ?)`
	consumeSignupChallengeStmt        = `DELETE FROM signup_challenges WHERE project_id = ? AND flow_id = ? AND id = ? AND expires_at > ?`
	deleteExpiredSignupChallengesStmt = `DELETE FROM signup_challenges WHERE project_id = ? AND expires_at <= ?`
	getSignupLimitsStmt               = `SELECT project_id, window_start, issued, verified FROM signup_limits WHERE project_id = ?`
	insertSignupLimitsStmt            = `INSERT INTO signup_limits (project_id, window_start, issued, verified) VALUES (?, ?, ?, ?)`
	updateSignupLimitsStmt            = `UPDATE signup_limits SET window_start = ?, issued = ?, verified = ? WHERE project_id = ?`
)

type signupProtectionStatements struct{ statement }

func newSignupProtectionStatements(client queryExecutor) signupProtectionStatements {
	return signupProtectionStatements{statement: statement{client: client}}
}
func (s signupProtectionStatements) GetSignupChallenge(ctx context.Context, projectID, flowID string) (*domain.SignupChallengeRecord, error) {
	var record domain.SignupChallengeRecord
	err := wrapError(s.client.QueryRow(ctx, getSignupChallengeStmt, projectID, flowID).Scan(&record.ProjectID, &record.FlowID, &record.ID, &record.ExpiresAt, &record.Payload))
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
	err := wrapError(s.client.QueryRow(ctx, getSignupLimitsStmt, projectID).Scan(&record.ProjectID, &record.WindowStart, &record.Issued, &record.Verified))
	if errors.Is(err, new(database.NoRowFoundError)) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}
func (s signupProtectionStatements) CreateSignupChallenge(ctx context.Context, r *domain.SignupChallengeRecord) error {
	_, err := execAffected(ctx, s.client, createSignupChallengeStmt, r.ProjectID, r.FlowID, r.ID, r.ExpiresAt, r.Payload)
	return wrapError(err)
}
func (s signupProtectionStatements) ConsumeSignupChallenge(ctx context.Context, projectID, flowID, id string, now int64) (bool, error) {
	n, err := execAffected(ctx, s.client, consumeSignupChallengeStmt, projectID, flowID, id, now)
	return n == 1, wrapError(err)
}
func (s signupProtectionStatements) DeleteExpiredSignupChallenges(ctx context.Context, projectID string, now int64) error {
	_, err := execAffected(ctx, s.client, deleteExpiredSignupChallengesStmt, projectID, now)
	return wrapError(err)
}
func (s signupProtectionStatements) InsertSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := execAffected(ctx, s.client, insertSignupLimitsStmt, r.ProjectID, r.WindowStart, r.Issued, r.Verified)
	return wrapError(err)
}
func (s signupProtectionStatements) UpdateSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := execAffected(ctx, s.client, updateSignupLimitsStmt, r.WindowStart, r.Issued, r.Verified, r.ProjectID)
	return wrapError(err)
}
