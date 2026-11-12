package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	authRequestColumns    = `project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, created_at, expires_at`
	createAuthRequestStmt = `INSERT INTO auth_requests (` + authRequestColumns + `)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	getAuthRequestStmt           = `SELECT ` + authRequestColumns + ` FROM auth_requests WHERE project_id = ? AND id = ?`
	deleteExpiredAuthRequestStmt = `DELETE FROM auth_requests WHERE project_id = ?1 AND expires_at <= ?2` +
		` AND id IN (SELECT id FROM auth_requests WHERE project_id = ?1 AND expires_at <= ?2 LIMIT ?3)`
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
	scopes, err := encodeJSON(request.Scopes)
	if err != nil {
		return wrapError(err)
	}
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createAuthRequestStmt,
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
		now,
		request.ExpiresAt.UnixNano(),
	); err != nil {
		return wrapError(err)
	}
	request.CreatedAt = timeFromUnixNano(now)
	return nil
}

// GetAuthRequest implements [service.AuthRequestStatements].
func (s authRequestStatements) GetAuthRequest(ctx context.Context, projectID, id string) (*domain.AuthRequest, error) {
	rows, err := s.client.Query(ctx, getAuthRequestStmt, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	request, err := collectExactlyOneRow(rows, scanAuthRequest)
	if err != nil {
		return nil, wrapError(err)
	}
	return request, nil
}

// DeleteExpiredAuthRequests implements [service.AuthRequestStatements].
func (s authRequestStatements) DeleteExpiredAuthRequests(ctx context.Context, projectID string, now time.Time, limit int) error {
	_, err := s.client.Exec(ctx, deleteExpiredAuthRequestStmt, projectID, now.UnixNano(), limit)
	return wrapError(err)
}

func scanAuthRequest(rows *sql.Rows) (*domain.AuthRequest, error) {
	var (
		request     domain.AuthRequest
		scopes      string
		createdNano int64
		expiresNano int64
	)
	if err := rows.Scan(
		&request.ProjectID,
		&request.ID,
		&request.ClientID,
		&request.RedirectURI,
		&request.State,
		&scopes,
		&request.CodeChallenge,
		&request.Issuer,
		&request.DeploymentID,
		&request.ReleaseID,
		&request.BindingHash,
		&createdNano,
		&expiresNano,
	); err != nil {
		return nil, err
	}
	var err error
	if request.Scopes, err = decodeJSONStrings(scopes); err != nil {
		return nil, fmt.Errorf("decode auth request scopes: %w", err)
	}
	request.CreatedAt = timeFromUnixNano(createdNano)
	request.ExpiresAt = timeFromUnixNano(expiresNano)
	return &request, nil
}

var _ service.AuthRequestStatements = (*authRequestStatements)(nil)
