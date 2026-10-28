package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
)

// ErrOAuthGrantTokenSpent is returned when a code or refresh token's record is
// gone: it was used already, or its grant was revoked. A refresh token
// presented twice is the replay ADR 037 asks the server to detect, and the
// rotation revokes the grant before answering it.
var ErrOAuthGrantTokenSpent = errors.New("oauth grant token already used or revoked")

// OAuthGrantToken is the record of one authorization code or refresh token of
// an OAuth grant. The token itself is sealed and handed to the client; only
// this record, keyed by its id, is stored (ADR 037), as an oidc_access_token
// row whose oidc_session_id is the grant.
type OAuthGrantToken struct {
	ProjectID string
	GrantID   string
	UserID    string
	Scope     []string
	ExpiresAt time.Time
}

// OAuthGrantService keeps the single-use records behind an OAuth grant: the
// authorization code that starts it and the refresh tokens that rotate from
// it. Each write emits its event in the same transaction.
type OAuthGrantService interface {
	// NewGrantID mints the id a new grant's records share.
	NewGrantID() (string, error)
	// Issue writes the record of a new code or refresh token and returns its id.
	Issue(ctx context.Context, token OAuthGrantToken) (string, error)
	// Redeem uses a code's record up. ErrOAuthGrantTokenSpent means it was
	// redeemed or revoked already.
	Redeem(ctx context.Context, projectID, tokenID string) error
	// Rotate uses a refresh token's record up and writes the next one's, in
	// one transaction. When the record is gone the token was replayed: the
	// whole grant is revoked and ErrOAuthGrantTokenSpent returned.
	Rotate(ctx context.Context, projectID, tokenID string, next OAuthGrantToken) (string, error)
	// Revoke ends a grant: its code and every refresh token.
	Revoke(ctx context.Context, projectID, grantID string) error
}

type oauthGrantService struct {
	pool StatementPool
}

func NewOAuthGrantService(pool StatementPool) OAuthGrantService {
	return &oauthGrantService{pool: pool}
}

func (s *oauthGrantService) NewGrantID() (string, error) {
	return s.pool.Statements().NewManagedID(string(domain.PrefixOAuthGrant))
}

func (s *oauthGrantService) Issue(ctx context.Context, token OAuthGrantToken) (_ string, err error) {
	ctx, end := startSpan(ctx, "OAuthGrantService.Issue")
	defer end(&err)

	var id string
	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var err error
		id, err = issueGrantToken(ctx, tx.Statements(), token)
		return err
	})
	if err != nil {
		return "", grantStorageError(err, "failed to issue oauth grant token")
	}
	return id, nil
}

func (s *oauthGrantService) Redeem(ctx context.Context, projectID, tokenID string) (err error) {
	ctx, end := startSpan(ctx, "OAuthGrantService.Redeem")
	defer end(&err)

	found, err := s.pool.Statements().ConsumeTokenByID(ctx, projectID, tokenID)
	if err != nil {
		return grantStorageError(err, "failed to redeem oauth code")
	}
	if !found {
		return ErrOAuthGrantTokenSpent
	}
	return nil
}

func (s *oauthGrantService) Rotate(ctx context.Context, projectID, tokenID string, next OAuthGrantToken) (_ string, err error) {
	ctx, end := startSpan(ctx, "OAuthGrantService.Rotate")
	defer end(&err)

	var id string
	replayed := false
	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		// A retry re-runs the closure, so it starts from nothing each time.
		id, replayed = "", false
		found, err := tx.Statements().ConsumeTokenByID(ctx, projectID, tokenID)
		if err != nil {
			return err
		}
		if !found {
			replayed = true
			return revokeGrant(ctx, tx.Statements(), projectID, next.GrantID)
		}
		id, err = issueGrantToken(ctx, tx.Statements(), next)
		return err
	})
	if err != nil {
		return "", grantStorageError(err, "failed to rotate oauth refresh token")
	}
	if replayed {
		return "", ErrOAuthGrantTokenSpent
	}
	return id, nil
}

func (s *oauthGrantService) Revoke(ctx context.Context, projectID, grantID string) (err error) {
	ctx, end := startSpan(ctx, "OAuthGrantService.Revoke")
	defer end(&err)

	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return revokeGrant(ctx, tx.Statements(), projectID, grantID)
	})
	if err != nil {
		return grantStorageError(err, "failed to revoke oauth grant")
	}
	return nil
}

func issueGrantToken(ctx context.Context, stmts AllStatements, token OAuthGrantToken) (string, error) {
	grantID := token.GrantID
	expiresAt := token.ExpiresAt
	record := &domain.Token{
		ProjectID:     token.ProjectID,
		UserID:        token.UserID,
		Type:          domain.TokenTypeOIDCAccessToken,
		OIDCSessionID: &grantID,
		Scope:         token.Scope,
		ExpiresAt:     &expiresAt,
	}
	if err := stmts.CreateToken(ctx, record); err != nil {
		return "", err
	}
	if err := emitAuthTokenIssued(ctx, stmts, record.ProjectID, record.TokenID, nil, tokenUserID(record), record.Scope); err != nil {
		return "", err
	}
	return record.TokenID, nil
}

func revokeGrant(ctx context.Context, stmts AllStatements, projectID, grantID string) error {
	if err := stmts.DeleteTokensByOIDCSessionID(ctx, projectID, grantID); err != nil {
		return err
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeAuthTokenRevoked,
		Category:   domain.EventCategoryAuth,
		ProjectID:  projectID,
		EntityType: "token",
		EntityID:   grantID,
		Payload:    domain.AuthTokenRevokedPayload{},
	})
}

// grantStorageError keeps a classified failure's code, so an unavailable
// token store answers 503 and clients retry, and wraps anything else.
func grantStorageError(err error, message string) error {
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if mapped := mapStorageError(err); mapped != err {
		return mapped
	}
	return domain.ErrInternal(err).WithMessage(message)
}
