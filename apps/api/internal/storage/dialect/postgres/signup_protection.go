package postgres

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	getSignupChallengeStmt            = `SELECT project_id, flow_id, id, expires_at, payload, public FROM zitadel_nextgen.signup_challenges WHERE project_id = $1 AND flow_id = $2`
	createSignupChallengeStmt         = `INSERT INTO zitadel_nextgen.signup_challenges (project_id, flow_id, id, expires_at, payload, public) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (project_id, flow_id) DO UPDATE SET id = excluded.id, expires_at = excluded.expires_at, payload = excluded.payload, public = excluded.public`
	consumeSignupChallengeStmt        = `DELETE FROM zitadel_nextgen.signup_challenges WHERE project_id = $1 AND flow_id = $2 AND id = $3 AND expires_at > $4`
	deleteExpiredSignupChallengesStmt = `DELETE FROM zitadel_nextgen.signup_challenges WHERE project_id = $1 AND expires_at <= $2 AND flow_id IN (SELECT flow_id FROM zitadel_nextgen.signup_challenges WHERE project_id = $1 AND expires_at <= $2 LIMIT $3)`
	deleteExpiredSignupLimitsStmt     = `DELETE FROM zitadel_nextgen.signup_limits WHERE project_id = $1 AND window_start <= $2 AND flow_id IN (SELECT flow_id FROM zitadel_nextgen.signup_limits WHERE project_id = $1 AND window_start <= $2 LIMIT $3)`
	getSignupLimitsStmt               = `SELECT project_id, flow_id, window_start, issued, verified FROM zitadel_nextgen.signup_limits WHERE project_id = $1 AND flow_id = $2 FOR UPDATE`
	insertSignupLimitsStmt            = `INSERT INTO zitadel_nextgen.signup_limits (project_id, flow_id, window_start, issued, verified) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id, flow_id) DO NOTHING`
	updateSignupLimitsStmt            = `UPDATE zitadel_nextgen.signup_limits SET window_start = $1, issued = $2, verified = $3 WHERE project_id = $4 AND flow_id = $5`
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
	_, err := s.client.Exec(ctx, createSignupChallengeStmt, r.ProjectID, r.FlowID, r.ID, r.ExpiresAt, r.Payload, r.Public)
	return wrapError(err)
}
func (s signupProtectionStatements) ConsumeSignupChallenge(ctx context.Context, projectID, flowID, id string, now int64) (bool, error) {
	n, err := s.client.Exec(ctx, consumeSignupChallengeStmt, projectID, flowID, id, now)
	return n.RowsAffected() == 1, wrapError(err)
}

// DeleteExpiredSignupProtection deletes at most limit expired rows of each
// table, so a backlog drains over several sweeps; the outer cutoff keeps a row
// refreshed since the subquery read it.
func (s signupProtectionStatements) DeleteExpiredSignupProtection(ctx context.Context, projectID string, now int64, limit int) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, deleteExpiredSignupChallengesStmt, projectID, now, limit); err != nil {
			return wrapError(err)
		}
		// Retain inactive counters for an hour, well beyond their one-minute window.
		_, err := tx.Exec(ctx, deleteExpiredSignupLimitsStmt, projectID, now-3600, limit)
		return wrapError(err)
	})
}
func (s signupProtectionStatements) InsertSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := s.client.Exec(ctx, insertSignupLimitsStmt, r.ProjectID, r.FlowID, r.WindowStart, r.Issued, r.Verified)
	return wrapError(err)
}
func (s signupProtectionStatements) UpdateSignupLimits(ctx context.Context, r *domain.SignupLimits) error {
	_, err := s.client.Exec(ctx, updateSignupLimitsStmt, r.WindowStart, r.Issued, r.Verified, r.ProjectID, r.FlowID)
	return wrapError(err)
}
