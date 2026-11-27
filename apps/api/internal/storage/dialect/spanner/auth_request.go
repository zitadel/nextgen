package spanner

import (
	"context"
	"strings"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authattempt"
)

const (
	authRequestTable      = "auth_requests"
	createAuthRequestStmt = `INSERT INTO auth_requests` +
		` (project_id, id, client_id, redirect_uri, state, scopes, code_challenge, issuer, deployment_id, release_id, binding_hash, expires_at, correlation_id)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13) THEN RETURN created_at`
	setAuthRequestCodeStmt = `UPDATE auth_requests SET code_hash = @p3, user_id = @p4, session_id = @p5, code_expires_at = @p6` +
		` WHERE project_id = @p1 AND id = @p2 AND code_hash IS NULL AND expires_at > @p7`
)

var authRequestColumns = []string{
	"project_id", "id", "client_id", "redirect_uri", "state", "scopes", "code_challenge",
	"issuer", "deployment_id", "release_id", "binding_hash", "created_at", "expires_at",
	"code_hash", "user_id", "session_id", "code_expires_at", "correlation_id",
}

// FORCE_INDEX keeps the delete on the code index, so it does not lock the
// project's other requests. The index is NULL_FILTERED, hence the IS NOT
// NULL (see userSearchQuery). The emulator still cannot prove that the index
// is usable and needs its own hint, which Cloud Spanner ignores.
var redeemAuthRequestCodeStmt = `DELETE FROM auth_requests@{FORCE_INDEX=uq_auth_requests_code_hash, spanner_emulator.disable_query_null_filtered_index_check=true}` +
	` WHERE project_id = @p1 AND code_hash = @p2 AND code_hash IS NOT NULL THEN RETURN ` +
	strings.Join(authRequestColumns, ", ")

type authRequestStatements struct{ statement }

func newAuthRequestStatements(db queryExecutor) authRequestStatements {
	return authRequestStatements{statement: statement{db: db}}
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
		authattempt.EmptyStringArg(request.CorrelationID),
	).statement()
	return s.db.Write(ctx, stmt, scanReturnedTimestamp(&request.CreatedAt))
}

// GetAuthRequest implements [service.AuthRequestStatements].
func (s authRequestStatements) GetAuthRequest(ctx context.Context, projectID, id string) (*domain.AuthRequest, error) {
	row, err := s.db.ReadRow(ctx, authRequestTable, spanner.Key{projectID, id}, authRequestColumns)
	if err != nil {
		return nil, err
	}
	return scanAuthRequest(row)
}

// SetAuthRequestCode implements [service.AuthRequestStatements].
func (s authRequestStatements) SetAuthRequestCode(ctx context.Context, request *domain.AuthRequest, now time.Time) error {
	n, err := s.db.Update(ctx, buildStatement(setAuthRequestCodeStmt,
		request.ProjectID,
		request.ID,
		request.CodeHash,
		request.UserID,
		request.SessionID,
		request.CodeExpiresAt,
		now,
	).statement())
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// RedeemAuthRequestCode implements [service.AuthRequestStatements].
func (s authRequestStatements) RedeemAuthRequestCode(ctx context.Context, projectID, codeHash string) (*domain.AuthRequest, error) {
	var request *domain.AuthRequest
	err := s.db.Write(ctx, buildStatement(redeemAuthRequestCodeStmt, projectID, codeHash).statement(), func(iter *spanner.RowIterator) error {
		var err error
		request, err = collectOneRow(iter, scanAuthRequest)
		return err
	})
	if err != nil {
		return nil, err
	}
	return request, nil
}

func scanAuthRequest(row *spanner.Row) (*domain.AuthRequest, error) {
	var (
		request                     domain.AuthRequest
		codeHash, userID, sessionID spanner.NullString
		correlationID               spanner.NullString
	)
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
		&codeHash,
		&userID,
		&sessionID,
		&request.CodeExpiresAt,
		&correlationID,
	); err != nil {
		return nil, err
	}
	request.CorrelationID = correlationID.StringVal
	request.CreatedAt = request.CreatedAt.UTC()
	request.ExpiresAt = request.ExpiresAt.UTC()
	request.CodeHash = codeHash.StringVal
	request.UserID = userID.StringVal
	request.SessionID = sessionID.StringVal
	if request.CodeExpiresAt != nil {
		request.CodeExpiresAt = new(request.CodeExpiresAt.UTC())
	}
	return &request, nil
}

var _ service.AuthRequestStatements = (*authRequestStatements)(nil)
