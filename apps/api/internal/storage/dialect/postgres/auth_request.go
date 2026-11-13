package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	authRequestColumns    = `project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, created_at, expires_at`
	createAuthRequestStmt = `INSERT INTO zitadel_nextgen.auth_requests` +
		` (project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, expires_at)` +
		` VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING created_at`
	getAuthRequestStmt           = `SELECT ` + authRequestColumns + ` FROM zitadel_nextgen.auth_requests WHERE project_id = $1 AND id = $2`
	deleteExpiredAuthRequestStmt = `DELETE FROM zitadel_nextgen.auth_requests WHERE project_id = $1 AND expires_at <= $2` +
		` AND id IN (SELECT id FROM zitadel_nextgen.auth_requests WHERE project_id = $1 AND expires_at <= $2 LIMIT $3)`
)

type authRequestStatements struct{ statement }

func newAuthRequestStatements(client queryExecutor) authRequestStatements {
	return authRequestStatements{statement: statement{client: client}}
}

// CreateAuthRequest implements [service.AuthRequestStatements].
func (s authRequestStatements) CreateAuthRequest(ctx context.Context, request *domain.AuthRequest) error {
	if err := ensureManagedID(&request.ID, domain.PrefixAuthRequest); err != nil {
		return err
	}
	if err := s.client.QueryRow(ctx, createAuthRequestStmt,
		request.ProjectID,
		request.ID,
		request.ClientID,
		request.RedirectURI,
		request.State,
		request.Scopes,
		request.CodeChallenge,
		request.Issuer,
		request.DeploymentID,
		request.ReleaseID,
		request.BindingHash,
		request.ExpiresAt,
	).Scan(&request.CreatedAt); err != nil {
		return wrapError(err)
	}
	request.CreatedAt = request.CreatedAt.UTC()
	return nil
}

// GetAuthRequest implements [service.AuthRequestStatements].
func (s authRequestStatements) GetAuthRequest(ctx context.Context, projectID, id string) (*domain.AuthRequest, error) {
	rows, err := s.client.Query(ctx, getAuthRequestStmt, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	request, err := pgx.CollectExactlyOneRow(rows, scanAuthRequest)
	if err != nil {
		return nil, wrapError(err)
	}
	return request, nil
}

// DeleteExpiredAuthRequests implements [service.AuthRequestStatements].
func (s authRequestStatements) DeleteExpiredAuthRequests(ctx context.Context, projectID string, now time.Time, limit int) error {
	_, err := s.client.Exec(ctx, deleteExpiredAuthRequestStmt, projectID, now, limit)
	return wrapError(err)
}

func scanAuthRequest(row pgx.CollectableRow) (*domain.AuthRequest, error) {
	var request domain.AuthRequest
	if err := row.Scan(
		&request.ProjectID,
		&request.ID,
		&request.ClientID,
		&request.RedirectURI,
		&request.State,
		&request.Scopes,
		&request.CodeChallenge,
		&request.Issuer,
		&request.DeploymentID,
		&request.ReleaseID,
		&request.BindingHash,
		&request.CreatedAt,
		&request.ExpiresAt,
	); err != nil {
		return nil, err
	}
	request.CreatedAt = request.CreatedAt.UTC()
	request.ExpiresAt = request.ExpiresAt.UTC()
	return &request, nil
}

var _ service.AuthRequestStatements = (*authRequestStatements)(nil)
