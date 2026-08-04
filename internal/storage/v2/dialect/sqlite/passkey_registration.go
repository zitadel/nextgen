package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	createPasskeyRegistrationStmt = `INSERT INTO passkey_registrations (id, project_id, user_id, challenge, expires_at, created_at)
VALUES (?, ?, ?, ?, ?, ?)`

	getPasskeyRegistrationStmt = `SELECT id, project_id, user_id, challenge, expires_at, created_at
FROM passkey_registrations WHERE id = ? AND project_id = ? AND expires_at > ?`

	deletePasskeyRegistrationStmt = `DELETE FROM passkey_registrations WHERE id = ? AND project_id = ?`
)

type passkeyRegistrationStatements struct{ statement }

func newPasskeyRegistrationStatements(client queryExecutor) passkeyRegistrationStatements {
	return passkeyRegistrationStatements{statement: statement{client: client}}
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
	now := nowUnixNano()
	_, err = ps.client.Exec(ctx, createPasskeyRegistrationStmt,
		reg.ID, reg.ProjectID, reg.UserID, string(challengeJSON), reg.ExpiresAt.UnixNano(), now,
	)
	return wrapError(err)
}

// GetPasskeyRegistration implements [service.PasskeyRegistrationStatements].
func (ps passkeyRegistrationStatements) GetPasskeyRegistration(ctx context.Context, projectID, id string) (*domain.PasskeyRegistration, error) {
	now := nowUnixNano()
	row := ps.client.QueryRow(ctx, getPasskeyRegistrationStmt, id, projectID, now)
	return scanPasskeyRegistrationRow(row)
}

// DeletePasskeyRegistration implements [service.PasskeyRegistrationStatements].
func (ps passkeyRegistrationStatements) DeletePasskeyRegistration(ctx context.Context, projectID, id string) error {
	_, err := ps.client.Exec(ctx, deletePasskeyRegistrationStmt, id, projectID)
	return wrapError(err)
}

func scanPasskeyRegistrationRow(row *sql.Row) (*domain.PasskeyRegistration, error) {
	var (
		reg           domain.PasskeyRegistration
		challengeJSON string
		expiresNano   int64
		createdNano   int64
	)
	if err := row.Scan(&reg.ID, &reg.ProjectID, &reg.UserID, &challengeJSON, &expiresNano, &createdNano); err != nil {
		return nil, wrapError(err)
	}
	reg.ExpiresAt = timeFromUnixNano(expiresNano)
	reg.CreatedAt = timeFromUnixNano(createdNano)
	reg.Challenge = new(domain.PasskeyRegistrationChallenge)
	if err := json.Unmarshal([]byte(challengeJSON), reg.Challenge); err != nil {
		return nil, fmt.Errorf("passkey_registration: unmarshal challenge: %w", err)
	}
	return &reg, nil
}

var _ service.PasskeyRegistrationStatements = (*passkeyRegistrationStatements)(nil)
