package domain

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// ErrInvalidTokenIdentifiers is returned when session identifier fields do not match [Token.Type].
var ErrInvalidTokenIdentifiers = errors.New("token identifiers do not match token type")

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/token_verifier.mock.go . TokenVerifier

type TokenVerifier interface {
	Verify(token string) (payload *Token, err error)
}

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/token_generator.mock.go . TokenGenerator,TokenGeneratorCreator

type TokenGenerator interface {
	Generate(token *Token) (string, error)
}

type TokenGeneratorCreator interface {
	Create(ctx context.Context, projectID string) (TokenGenerator, error)
}

// Token is a persisted token record (access, session, PAT, etc.).
// Revocation is modeled as deletion from storage.
type Token struct {
	ProjectID string
	TokenID   string
	UserID    string
	Type      TokenType
	// SessionID is set for [TokenTypeSessionToken] only.
	SessionID *string
	// OIDCSessionID is set for [TokenTypeOIDCAccessToken] only.
	OIDCSessionID *string
	// SAMLSessionID is set for [TokenTypeSAMLAssertion] only.
	SAMLSessionID *string
	Scope         []string
	CreatedAt     time.Time
	ExpiresAt     *time.Time
}

// ValidatePersisted checks identifier fields before writing to the tokens table.
func (t *Token) ValidatePersisted() error {
	if !t.Type.Persistable() {
		return ErrInvalidTokenType
	}
	switch t.Type {
	case TokenTypeSessionToken:
		if err := requireNonEmptyID(t.SessionID, "session_id"); err != nil {
			return err
		}
		if t.OIDCSessionID != nil || t.SAMLSessionID != nil {
			return ErrInvalidTokenIdentifiers
		}
	case TokenTypeOIDCAccessToken:
		if err := requireNonEmptyID(t.OIDCSessionID, "oidc_session_id"); err != nil {
			return err
		}
		if t.SessionID != nil || t.SAMLSessionID != nil {
			return ErrInvalidTokenIdentifiers
		}
	case TokenTypeSAMLAssertion:
		if err := requireNonEmptyID(t.SAMLSessionID, "saml_session_id"); err != nil {
			return err
		}
		if t.SessionID != nil || t.OIDCSessionID != nil {
			return ErrInvalidTokenIdentifiers
		}
	case TokenTypePersonalAccessToken:
		if t.SessionID != nil || t.OIDCSessionID != nil || t.SAMLSessionID != nil {
			return ErrInvalidTokenIdentifiers
		}
	case TokenTypeUnspecified:
		return ErrInvalidTokenType
	case TokenTypeFlow:
		return ErrInvalidTokenType
	case TokenTypeJWTProfile:
		return ErrInvalidTokenType
	default:
		return ErrInvalidTokenType
	}
	return nil
}

func requireNonEmptyID(id *string, name string) error {
	if id == nil || *id == "" {
		return fmt.Errorf("%w: %s is required", ErrInvalidTokenIdentifiers, name)
	}
	return nil
}

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/token.mock.go . TokenRepository

// TokenRepository persists token metadata: identity, scope, optional session and expiry.
type TokenRepository interface {
	Repository

	tokenConditions

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*Token, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*Token, error)
	Create(ctx context.Context, client database.QueryExecutor, token *Token) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type tokenConditions interface {
	PrimaryKeyCondition(projectID, tokenID string) database.Condition
	ProjectIDCondition(projectID string) database.Condition
	TokenIDCondition(tokenID string) database.Condition
	UserIDCondition(userID string) database.Condition
}
