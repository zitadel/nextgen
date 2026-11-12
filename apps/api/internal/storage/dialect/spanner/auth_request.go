package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	authRequestTable      = "auth_requests"
	createAuthRequestStmt = `INSERT INTO auth_requests` +
		` (project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, expires_at)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12) THEN RETURN created_at`
	expiredAuthRequestsQuery     = `SELECT id FROM auth_requests@{FORCE_INDEX=idx_auth_requests_project_expires_at} WHERE project_id = @p1 AND expires_at <= @p2 LIMIT @p3`
	deleteExpiredAuthRequestStmt = `DELETE FROM auth_requests WHERE project_id = @p1 AND expires_at <= @p2 AND id IN UNNEST(@p3)`
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
	scopes := request.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	stmt := buildStatement(createAuthRequestStmt,
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

// DeleteExpiredAuthRequests implements [service.AuthRequestStatements]. The
// delete checks expiry again, so the read and the write need no transaction.
func (s authRequestStatements) DeleteExpiredAuthRequests(ctx context.Context, projectID string, now time.Time, limit int) error {
	var ids []string
	err := s.db.Query(ctx, buildStatement(expiredAuthRequestsQuery, projectID, now, int64(limit)).statement(), func(iter *spanner.RowIterator) error {
		var err error
		ids, err = collectRows(iter, func(row *spanner.Row) (string, error) {
			var id string
			return id, row.Columns(&id)
		})
		return err
	})
	if err != nil || len(ids) == 0 {
		return err
	}
	_, err = s.db.Update(ctx, buildStatement(deleteExpiredAuthRequestStmt, projectID, now, ids).statement())
	return wrapError(err)
}

var _ service.AuthRequestStatements = (*authRequestStatements)(nil)
