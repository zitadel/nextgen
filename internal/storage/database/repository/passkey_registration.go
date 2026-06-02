package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const passkeyRegistrationTable = "zitadel_nextgen.passkey_registrations"

var _ domain.PasskeyRegistrationRepository = (*PasskeyRegistrationRepository)(nil)

// PasskeyRegistrationRepository implements [domain.PasskeyRegistrationRepository]
// for Postgres.
type PasskeyRegistrationRepository struct{}

func NewPasskeyRegistrationRepository() *PasskeyRegistrationRepository {
	return &PasskeyRegistrationRepository{}
}

func (r *PasskeyRegistrationRepository) Create(ctx context.Context, client database.QueryExecutor, reg *domain.CreatePasskeyRegistration) error {
	challengeJSON, err := json.Marshal(reg.Challenge)
	if err != nil {
		return fmt.Errorf("passkey_registration: marshal challenge: %w", err)
	}
	_, err = client.Exec(ctx,
		`INSERT INTO `+passkeyRegistrationTable+
			` (id, project_id, user_id, challenge, expires_at)`+
			` VALUES ($1, $2, $3, $4::JSONB, $5)`,
		reg.ID, reg.ProjectID, reg.UserID, challengeJSON, reg.ExpiresAt,
	)
	return err
}

func (r *PasskeyRegistrationRepository) Get(ctx context.Context, client database.QueryExecutor, projectID, id string) (*domain.PasskeyRegistration, error) {
	var (
		reg          domain.PasskeyRegistration
		challengeRaw []byte
	)
	err := client.QueryRow(ctx,
		`SELECT id, project_id, user_id, challenge, expires_at, created_at`+
			` FROM `+passkeyRegistrationTable+
			` WHERE id = $1 AND project_id = $2 AND expires_at > NOW()`,
		id, projectID,
	).Scan(&reg.ID, &reg.ProjectID, &reg.UserID, &challengeRaw, &reg.ExpiresAt, &reg.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrPasskeyRegistrationNotFound()
		}
		return nil, err
	}
	reg.Challenge = new(domain.PasskeyRegistrationChallenge)
	if err := json.Unmarshal(challengeRaw, reg.Challenge); err != nil {
		return nil, fmt.Errorf("passkey_registration: unmarshal challenge: %w", err)
	}
	return &reg, nil
}

func (r *PasskeyRegistrationRepository) Delete(ctx context.Context, client database.QueryExecutor, projectID, id string) error {
	_, err := client.Exec(ctx,
		`DELETE FROM `+passkeyRegistrationTable+` WHERE id = $1 AND project_id = $2`,
		id, projectID,
	)
	return err
}
