package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/muhlemmer/gu"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	authRequestColumns    = `project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, created_at, expires_at, code_hash, user_id, session_id, code_expires_at`
	createAuthRequestStmt = `INSERT INTO zitadel_nextgen.auth_requests` +
		` (project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, expires_at)` +
		` VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING created_at`
	getAuthRequestStmt     = `SELECT ` + authRequestColumns + ` FROM zitadel_nextgen.auth_requests WHERE project_id = $1 AND id = $2`
	setAuthRequestCodeStmt = `UPDATE zitadel_nextgen.auth_requests SET code_hash = $3, user_id = $4, session_id = $5, code_expires_at = $6` +
		` WHERE project_id = $1 AND id = $2 AND code_hash IS NULL`
	redeemAuthRequestCodeStmt = `DELETE FROM zitadel_nextgen.auth_requests WHERE project_id = $1 AND code_hash = $2 RETURNING ` + authRequestColumns
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
	// A nil slice is written as NULL, which the column refuses.
	scopes := request.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	if err := s.client.QueryRow(ctx, createAuthRequestStmt,
		request.ProjectID,
		request.ID,
		request.ClientID,
		request.RedirectURI,
		request.State,
		scopes,
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

// SetAuthRequestCode implements [service.AuthRequestStatements].
func (s authRequestStatements) SetAuthRequestCode(ctx context.Context, request *domain.AuthRequest) error {
	tag, err := s.client.Exec(ctx, setAuthRequestCodeStmt,
		request.ProjectID,
		request.ID,
		request.CodeHash,
		request.UserID,
		request.SessionID,
		request.CodeExpiresAt,
	)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// RedeemAuthRequestCode implements [service.AuthRequestStatements].
func (s authRequestStatements) RedeemAuthRequestCode(ctx context.Context, projectID, codeHash string) (*domain.AuthRequest, error) {
	rows, err := s.client.Query(ctx, redeemAuthRequestCodeStmt, projectID, codeHash)
	if err != nil {
		return nil, wrapError(err)
	}
	request, err := pgx.CollectExactlyOneRow(rows, scanAuthRequest)
	if err != nil {
		return nil, wrapError(err)
	}
	return request, nil
}

func scanAuthRequest(row pgx.CollectableRow) (*domain.AuthRequest, error) {
	var (
		request                     domain.AuthRequest
		codeHash, userID, sessionID *string
	)
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
		&codeHash,
		&userID,
		&sessionID,
		&request.CodeExpiresAt,
	); err != nil {
		return nil, err
	}
	request.CodeHash = gu.Value(codeHash)
	request.UserID = gu.Value(userID)
	request.SessionID = gu.Value(sessionID)
	request.CreatedAt = request.CreatedAt.UTC()
	request.ExpiresAt = request.ExpiresAt.UTC()
	return &request, nil
}

var _ service.AuthRequestStatements = (*authRequestStatements)(nil)
