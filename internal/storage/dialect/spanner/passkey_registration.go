package spanner

import (
	"context"
	"encoding/json"
	"fmt"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	createPasskeyRegistrationStmt = `INSERT INTO passkey_registrations (id, project_id, user_id, challenge, expires_at) VALUES (@p1, @p2, @p3, PARSE_JSON(@p4), @p5)`
	getPasskeyRegistrationStmt    = `SELECT id, project_id, user_id, TO_JSON_STRING(challenge), expires_at, created_at FROM passkey_registrations WHERE id = @p1 AND project_id = @p2 AND expires_at > CURRENT_TIMESTAMP()`
	deletePasskeyRegistrationStmt = `DELETE FROM passkey_registrations WHERE id = @p1 AND project_id = @p2`
)

type passkeyRegistrationStatements struct{ statement }

func newPasskeyRegistrationStatements(db queryExecutor) passkeyRegistrationStatements {
	return passkeyRegistrationStatements{
		statement: statement{
			db: db,
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
	stmt := buildStatement(createPasskeyRegistrationStmt, reg.ID, reg.ProjectID, reg.UserID, string(challengeJSON), reg.ExpiresAt).statement()
	_, err = ps.db.Update(ctx, stmt)
	return err
}

// GetPasskeyRegistration implements [service.PasskeyRegistrationStatements].
func (ps passkeyRegistrationStatements) GetPasskeyRegistration(ctx context.Context, projectID, id string) (*domain.PasskeyRegistration, error) {
	stmt := buildStatement(getPasskeyRegistrationStmt, id, projectID).statement()
	var reg *domain.PasskeyRegistration
	err := ps.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		reg, err = collectOneRow(iter, ps.scanPasskeyRegistration)
		return err
	})
	return reg, err
}

// DeletePasskeyRegistration implements [service.PasskeyRegistrationStatements].
func (ps passkeyRegistrationStatements) DeletePasskeyRegistration(ctx context.Context, projectID, id string) error {
	stmt := buildStatement(deletePasskeyRegistrationStmt, id, projectID).statement()
	_, err := ps.db.Update(ctx, stmt)
	return err
}

func (ps passkeyRegistrationStatements) scanPasskeyRegistration(row *spanner.Row) (*domain.PasskeyRegistration, error) {
	var (
		reg           domain.PasskeyRegistration
		challengeJSON string
	)
	if err := row.Columns(&reg.ID, &reg.ProjectID, &reg.UserID, &challengeJSON, &reg.ExpiresAt, &reg.CreatedAt); err != nil {
		return nil, err
	}
	reg.Challenge = new(domain.PasskeyRegistrationChallenge)
	if err := json.Unmarshal([]byte(challengeJSON), reg.Challenge); err != nil {
		return nil, fmt.Errorf("passkey_registration: unmarshal challenge: %w", err)
	}
	return &reg, nil
}

var _ service.PasskeyRegistrationStatements = (*passkeyRegistrationStatements)(nil)
