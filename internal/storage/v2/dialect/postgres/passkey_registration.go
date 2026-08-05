package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	createPasskeyRegistrationStmt = `INSERT INTO zitadel_nextgen.passkey_registrations (id, project_id, user_id, challenge, expires_at) VALUES ($1, $2, $3, $4::JSONB, $5)`
	getPasskeyRegistrationStmt    = `SELECT id, project_id, user_id, challenge, expires_at, created_at FROM zitadel_nextgen.passkey_registrations WHERE id = $1 AND project_id = $2 AND expires_at > now()`
	deletePasskeyRegistrationStmt = `DELETE FROM zitadel_nextgen.passkey_registrations WHERE id = $1 AND project_id = $2`
)

type passkeyRegistrationStatements struct{ statement }

func newPasskeyRegistrationStatements(client queryExecutor) passkeyRegistrationStatements {
	return passkeyRegistrationStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreatePasskeyRegistration implements [service.PasskeyRegistrationStatements].
func (ps passkeyRegistrationStatements) CreatePasskeyRegistration(ctx context.Context, reg *domain.CreatePasskeyRegistration) error {
	if err := ensureManagedID(&reg.ID, domain.PrefixPasskeyRegistration); err != nil {
		return err
	}
	challengeJSON, err := json.Marshal(reg.Challenge)
	if err != nil {
		return fmt.Errorf("passkey_registration: marshal challenge: %w", err)
	}
	_, err = ps.client.Exec(ctx, createPasskeyRegistrationStmt, reg.ID, reg.ProjectID, reg.UserID, challengeJSON, reg.ExpiresAt)
	return wrapError(err)
}

// GetPasskeyRegistration implements [service.PasskeyRegistrationStatements].
func (ps passkeyRegistrationStatements) GetPasskeyRegistration(ctx context.Context, projectID, id string) (*domain.PasskeyRegistration, error) {
	var (
		reg          domain.PasskeyRegistration
		challengeRaw []byte
	)
	err := ps.client.QueryRow(ctx, getPasskeyRegistrationStmt, id, projectID).
		Scan(&reg.ID, &reg.ProjectID, &reg.UserID, &challengeRaw, &reg.ExpiresAt, &reg.CreatedAt)
	if err != nil {
		return nil, wrapError(err)
	}
	reg.Challenge = new(domain.PasskeyRegistrationChallenge)
	if err := json.Unmarshal(challengeRaw, reg.Challenge); err != nil {
		return nil, fmt.Errorf("passkey_registration: unmarshal challenge: %w", err)
	}
	return &reg, nil
}

// DeletePasskeyRegistration implements [service.PasskeyRegistrationStatements].
func (ps passkeyRegistrationStatements) DeletePasskeyRegistration(ctx context.Context, projectID, id string) error {
	_, err := ps.client.Exec(ctx, deletePasskeyRegistrationStmt, id, projectID)
	return wrapError(err)
}

var _ service.PasskeyRegistrationStatements = (*passkeyRegistrationStatements)(nil)
