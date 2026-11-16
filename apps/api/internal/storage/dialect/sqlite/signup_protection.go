package sqlite

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	getSignupChallengeStmt            = `SELECT project_id, flow_id, id, expires_at, payload, public FROM signup_challenges WHERE project_id = ? AND flow_id = ?`
	createSignupChallengeStmt         = `INSERT INTO signup_challenges (project_id, flow_id, id, expires_at, payload, public) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (project_id, flow_id) DO UPDATE SET id = excluded.id, expires_at = excluded.expires_at, payload = excluded.payload, public = excluded.public`
	consumeSignupChallengeStmt        = `DELETE FROM signup_challenges WHERE project_id = ? AND flow_id = ? AND id = ? AND expires_at > ?`
	deleteExpiredSignupChallengesStmt = `DELETE FROM signup_challenges WHERE project_id = ?1 AND expires_at <= ?2 AND flow_id IN (SELECT flow_id FROM signup_challenges WHERE project_id = ?1 AND expires_at <= ?2 LIMIT ?3)`
	deleteExpiredSignupLimitsStmt     = `DELETE FROM signup_limits WHERE project_id = ?1 AND window_start <= ?2 AND flow_id IN (SELECT flow_id FROM signup_limits WHERE project_id = ?1 AND window_start <= ?2 LIMIT ?3)`
	getSignupLimitsStmt               = `SELECT project_id, flow_id, window_start, issued, verified FROM signup_limits WHERE project_id = ? AND flow_id = ?`
	insertSignupLimitsStmt            = `INSERT INTO signup_limits (project_id, flow_id, window_start, issued, verified) VALUES (?, ?, ?, ?, ?) ON CONFLICT (project_id, flow_id) DO NOTHING`
	updateSignupLimitsStmt            = `UPDATE signup_limits SET window_start = ?, issued = ?, verified = ? WHERE project_id = ? AND flow_id = ?`
)

type signupProtectionStatements struct{ statement }

func newSignupProtectionStatements(client queryExecutor) signupProtectionStatements {
	return signupProtectionStatements{statement: statement{client: client}}
}
func (s signupProtectionStatements) GetSignupChallenge(ctx context.Context, projectID, flowID string) (*domain.SignupChallengeRecord, error) {
	var record domain.SignupChallengeRecord
	err := wrapError(s.client.QueryRow(ctx, getSignupChallengeStmt, projectID, flowID).Scan(&record.ProjectID, &record.FlowID, &record.ID, &record.ExpiresAt, &record.Payload, &record.Public))
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
	err := wrapError(s.client.QueryRow(ctx, getSignupLimitsStmt, projectID, flowID).Scan(&record.ProjectID, &record.FlowID, &record.WindowStart, &record.Issued, &record.Verified))
	if errors.Is(err, new(database.NoRowFoundError)) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}
func (s signupProtectionStatements) CreateSignupChallenge(ctx context.Context, r *domain.SignupChallengeRecord) error {
	_, err := execAffected(ctx, s.client, createSignupChallengeStmt, r.ProjectID, r.FlowID, r.ID, r.ExpiresAt, r.Payload, r.Public)
	return wrapError(err)
}
func (s signupProtectionStatements) ConsumeSignupChallenge(ctx context.Context, projectID, flowID, id string, now int64) (bool, error) {
	n, err := execAffected(ctx, s.client, consumeSignupChallengeStmt, projectID, flowID, id, now)
	return n == 1, wrapError(err)
}

// DeleteExpiredSignupProtection deletes at most limit expired rows of each
// table, so a sweep holds the writer lock briefly; the outer cutoff keeps a
// row refreshed since the subquery read it.
func (s signupProtectionStatements) DeleteExpiredSignupProtection(ctx context.Context, projectID string, now int64, limit int) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := execAffected(ctx, tx, deleteExpiredSignupChallengesStmt, projectID, now, limit); err != nil {
			return wrapError(err)
		}
		// Retain inactive counters for an hour, well beyond their one-minute window.
		_, err := execAffected(ctx, tx, deleteExpiredSignupLimitsStmt, projectID, now-3600, limit)
		return wrapError(err)
	})
}
func (s signupProtectionStatements) InsertSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := execAffected(ctx, s.client, insertSignupLimitsStmt, r.ProjectID, r.FlowID, r.WindowStart, r.Issued, r.Verified)
	return wrapError(err)
}
func (s signupProtectionStatements) UpdateSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := execAffected(ctx, s.client, updateSignupLimitsStmt, r.WindowStart, r.Issued, r.Verified, r.ProjectID, r.FlowID)
	return wrapError(err)
}
