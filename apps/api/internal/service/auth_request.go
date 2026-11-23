package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/oidc/v3/pkg/crypto"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// AuthRequestService stores the authorization requests the OAuth endpoint
// hands to the login (ADR 081 §8).
type AuthRequestService interface {
	// Create stores request with a new binding and an expiry, and returns the
	// nonce the browser's binding cookie holds.
	Create(ctx context.Context, request *domain.AuthRequest) (bindingNonce string, err error)
	// IssueCode gives the request its authorization code, for the user and
	// session the login signed in. A request gets one code; an unknown request
	// or one that already has a code returns [domain.ErrAuthCodeNotIssued].
	IssueCode(ctx context.Context, projectID, authRequestID, userID, sessionID string) (code string, err error)
	// RedeemCode consumes a code and returns the access token it is
	// exchanged for, writing auth.token.issued. A refused code is consumed
	// too and writes auth.request.exchange.failed with the reason; an unknown
	// code writes nothing. A server fault leaves the code redeemable.
	RedeemCode(ctx context.Context, input RedeemCodeInput) (accessToken string, err error)
}

// RedeemCodeInput is what a client presents to redeem a code.
type RedeemCodeInput struct {
	ProjectID string
	// ClientID is the client the caller authenticated. A refusal records it in
	// the auth.request.exchange.failed event.
	ClientID     string
	Code         string
	RedirectURI  string
	CodeVerifier string
}

type authRequestService struct {
	db   StatementPool
	keys KeyService
}

func NewAuthRequestService(db StatementPool, keys KeyService) AuthRequestService {
	return &authRequestService{db: db, keys: keys}
}

// Create implements [AuthRequestService].
func (s *authRequestService) Create(ctx context.Context, request *domain.AuthRequest) (_ string, err error) {
	ctx, end := startSpan(ctx, "AuthRequestService.Create")
	defer end(&err)

	nonce, hash, err := domain.NewAuthRequestBinding()
	if err != nil {
		return "", err
	}
	request.BindingHash = hash
	request.ExpiresAt = time.Now().Add(domain.AuthRequestTTL)
	if err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateAuthRequest(ctx, request); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeAuthRequestCreated,
			Category:   domain.EventCategoryAuth,
			ProjectID:  request.ProjectID,
			EntityType: "auth_request",
			EntityID:   request.ID,
			Payload:    domain.AuthRequestCreatedPayload{ClientID: request.ClientID},
		})
	}); err != nil {
		if _, ok := errors.AsType[*database.UnavailableError](err); ok {
			return "", domain.ErrUnavailable().WithParent(err)
		}
		return "", domain.ErrInternal(err).WithMessage("failed to store the authorization request")
	}
	return nonce, nil
}

// IssueCode implements [AuthRequestService].
func (s *authRequestService) IssueCode(ctx context.Context, projectID, authRequestID, userID, sessionID string) (_ string, err error) {
	ctx, end := startSpan(ctx, "AuthRequestService.IssueCode")
	defer end(&err)

	if userID == "" || sessionID == "" {
		return "", domain.ErrInternal(nil).WithMessage("an authorization code needs a user and a session")
	}
	code, hash, err := domain.NewAuthCode()
	if err != nil {
		return "", err
	}
	if err := s.db.Statements().SetAuthRequestCode(ctx, &domain.AuthRequest{
		ProjectID:     projectID,
		ID:            authRequestID,
		CodeHash:      hash,
		UserID:        userID,
		SessionID:     sessionID,
		CodeExpiresAt: new(time.Now().UTC().Add(domain.AuthCodeTTL)),
	}); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return "", domain.ErrAuthCodeNotIssued()
		}
		if _, ok := errors.AsType[*database.UnavailableError](err); ok {
			return "", domain.ErrUnavailable().WithParent(err)
		}
		return "", domain.ErrInternal(err).WithMessage("failed to store the authorization code")
	}
	return code, nil
}

// RedeemCode implements [AuthRequestService].
func (s *authRequestService) RedeemCode(ctx context.Context, input RedeemCodeInput) (_ string, err error) {
	ctx, end := startSpan(ctx, "AuthRequestService.RedeemCode")
	defer end(&err)

	signer, err := s.keys.GetProjectSigner(ctx, input.ProjectID, domain.SigningKeyPurposeToken, (&jose.SignerOptions{}).WithType("at+jwt"))
	if err != nil {
		return "", err
	}
	codeHash := domain.HashSecret(input.Code)
	var token string
	var refusal error
	if err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		token, refusal = "", nil
		now := time.Now()
		stmts := tx.Statements()
		request, err := stmts.RedeemAuthRequestCode(ctx, input.ProjectID, codeHash)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				refusal = domain.ErrAuthCodeInvalid()
				return nil
			}
			return err
		}
		reason, err := redemptionRefusal(ctx, stmts, request, input, now)
		if err != nil {
			return err
		}
		if reason != "" {
			refusal = refusalError(reason)
			// A refusal returns nil, so the consumed code and its event commit
			// together; a failed emit rolls both back.
			return audit.Emit(ctx, stmts, audit.EmitSpec{
				Type:       domain.EventTypeAuthRequestExchangeFailed,
				Category:   domain.EventCategoryAuth,
				ProjectID:  request.ProjectID,
				EntityType: "auth_request",
				EntityID:   request.ID,
				UserID:     request.UserID,
				SessionID:  &request.SessionID,
				Payload:    domain.AuthRequestExchangeFailedPayload{ClientID: input.ClientID, Reason: reason},
			})
		}
		tokenID, err := stmts.NewManagedID(string(domain.TokenPrefix))
		if err != nil {
			return err
		}
		// Set field by field: oidc.NewAccessTokenClaims would add nbf.
		token, err = crypto.Sign(&oidc.AccessTokenClaims{TokenClaims: oidc.TokenClaims{
			Issuer:     request.Issuer,
			Subject:    request.UserID,
			Audience:   []string{request.ClientID},
			ClientID:   request.ClientID,
			IssuedAt:   oidc.FromTime(now),
			Expiration: oidc.FromTime(now.Add(domain.AccessTokenTTL)),
			JWTID:      tokenID,
		}, Scopes: request.Scopes}, signer)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to sign the access token")
		}
		return emitAuthTokenIssued(ctx, stmts, request.ProjectID, tokenID, &request.SessionID, nil, &request.UserID, request.Scopes)
	}); err != nil {
		if _, ok := errors.AsType[*database.UnavailableError](err); ok {
			return "", domain.ErrUnavailable().WithParent(err)
		}
		return "", domain.ErrInternal(err).WithMessage("failed to redeem the authorization code")
	}
	if refusal != nil {
		return "", refusal
	}
	return token, nil
}

// redemptionRefusal checks, in order, whether input may redeem the request
// its code consumed. It returns the reason of the refusal (empty when the
// request passes), or an error for a server fault.
func redemptionRefusal(ctx context.Context, stmts AllStatements, request *domain.AuthRequest, input RedeemCodeInput, now time.Time) (reason string, err error) {
	if input.ClientID != request.ClientID {
		return domain.AuthRequestExchangeReasonClientMismatch, nil
	}
	if request.CodeExpiresAt == nil || now.After(*request.CodeExpiresAt) {
		return domain.AuthRequestExchangeReasonCodeExpired, nil
	}
	if input.RedirectURI != request.RedirectURI {
		return domain.AuthRequestExchangeReasonRedirectURIMismatch, nil
	}
	switch {
	case request.CodeChallenge == "" && input.CodeVerifier != "":
		return domain.AuthRequestExchangeReasonCodeVerifierUnexpected, nil
	case request.CodeChallenge == "":
	case input.CodeVerifier == "":
		return domain.AuthRequestExchangeReasonCodeVerifierMissing, nil
	case subtle.ConstantTimeCompare([]byte(oidc.NewSHACodeChallenge(input.CodeVerifier)), []byte(request.CodeChallenge)) != 1:
		return domain.AuthRequestExchangeReasonCodeVerifierInvalid, nil
	}
	if request.ReleaseID != "" {
		release, err := stmts.GetReleaseByID(ctx, request.ProjectID, request.ReleaseID)
		if err != nil {
			return "", err
		}
		if release.Revoked() {
			return domain.AuthRequestExchangeReasonReleaseRevoked, nil
		}
	}
	session, err := stmts.GetSessionByID(ctx, request.ProjectID, request.SessionID)
	if errors.Is(err, domain.ErrSessionNotFound()) {
		return domain.AuthRequestExchangeReasonSessionNotActive, nil
	}
	if err != nil {
		return "", err
	}
	if session.State() != domain.SessionStateActive || session.UserID == nil || *session.UserID != request.UserID {
		return domain.AuthRequestExchangeReasonSessionNotActive, nil
	}
	_, err = stmts.GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), request.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), request.UserID),
		database.Equal(database.Col(domain.UserFieldStatus), domain.UserStatusActive.String()),
	), UserQueryOptions{})
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.AuthRequestExchangeReasonUserNotActive, nil
	}
	return "", err
}

// refusalError is the error a redemption refused for reason answers with.
// The client learns the cause only for what it sent; the rest is one error.
func refusalError(reason string) error {
	switch reason {
	case domain.AuthRequestExchangeReasonRedirectURIMismatch:
		return domain.ErrAuthCodeRedirectURIMismatch()
	case domain.AuthRequestExchangeReasonCodeVerifierMissing:
		return domain.ErrAuthCodeVerifierMissing()
	case domain.AuthRequestExchangeReasonCodeVerifierInvalid:
		return domain.ErrAuthCodeVerifierInvalid()
	case domain.AuthRequestExchangeReasonCodeVerifierUnexpected:
		return domain.ErrAuthCodeVerifierUnexpected()
	}
	return domain.ErrAuthCodeInvalid()
}
