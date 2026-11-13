package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	authRequestTable      = "auth_requests"
	createAuthRequestStmt = `INSERT INTO auth_requests` +
		` (project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, expires_at)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12) THEN RETURN created_at`
)

var authRequestColumns = []string{
	"project_id", "id", "client_id", "redirect_uri", "state", "scopes", "code_challenge",
	"issuer", "deployment_id", "release_id", "binding_hash", "created_at", "expires_at",
}

type authRequestStatements struct{ statement }

func newAuthRequestStatements(db queryExecutor) authRequestStatements {
	return authRequestStatements{statement: statement{db: db}}
}

// CreateAuthRequest implements [service.AuthRequestStatements].
func (s authRequestStatements) CreateAuthRequest(ctx context.Context, request *domain.AuthRequest) error {
	if err := ensureManagedID(&request.ID, domain.PrefixAuthRequest); err != nil {
		return err
	}
	stmt := buildStatement(createAuthRequestStmt,
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
	).statement()
	return s.db.Write(ctx, stmt, scanReturnedTimestamp(&request.CreatedAt))
}

// GetAuthRequest implements [service.AuthRequestStatements].
func (s authRequestStatements) GetAuthRequest(ctx context.Context, projectID, id string) (*domain.AuthRequest, error) {
	row, err := s.db.ReadRow(ctx, authRequestTable, spanner.Key{projectID, id}, authRequestColumns)
	if err != nil {
		return nil, err
	}
	var request domain.AuthRequest
	if err := row.Columns(
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
