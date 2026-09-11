package domain

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	crypto2 "github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/oidc/v3/pkg/op"
)

var TokenPrefix ResourcePrefix = "tkn"

// ErrInvalidTokenIdentifiers is returned when session identifier fields do not match [Token.Type].
func ErrInvalidTokenIdentifiers() Error {
	return newError(TokenPrefix.ErrorCodePrefix("invalid_tknid"), "token identifiers do not match token type", nil, nil)
}

func ErrInvalidToken() Error {
	return newError(TokenPrefix.ErrorCodePrefix("invalid"), "the token is not valid", nil, nil)
}

// ErrTokenRevoked is returned when a token decrypts and is well-formed but its
// record no longer grants anything — gone from storage or expired. It is
// deliberately indistinguishable from [ErrInvalidToken] to a caller: a bearer
// learns only that the credential does not work.
func ErrTokenRevoked() Error {
	return newError(TokenPrefix.ErrorCodePrefix("revoked"), "the token is not valid", nil, nil)
}

func TokenNotFound() Error {
	return newError(TokenPrefix.ErrorCodePrefix("not_found"), "the token was not found", nil, nil)
}

// Token is a persisted token record (access, session, PAT, etc.).
//
// A revocable token carries its record's id (`TokenID`, the `jti`). The token
// itself is never stored — only the id, which is not a secret (ADR 029) — and
// verification resolves that id against the record to decide whether the token
// is still active. Revocation deletes the record: a token whose record is gone
// is rejected, and the tokens table does not accumulate rows that grant nothing
// (ADR 037).
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

// IsRevocable reports whether this token's authority is resolved against a
// stored record. A revocable token must carry a TokenID to be verifiable.
func (t *Token) IsRevocable() bool { return t.Type.Persistable() }

// Active reports whether the stored record still grants the token's authority
// at the given instant. A revoked record is deleted, so reaching this call at
// all means the token was not revoked; only expiry is left to check.
func (t *Token) Active(now time.Time) bool {
	return t.ExpiresAt == nil || t.ExpiresAt.After(now)
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
			return ErrInvalidTokenIdentifiers()
		}
	case TokenTypeOIDCAccessToken:
		if err := requireNonEmptyID(t.OIDCSessionID, "oidc_session_id"); err != nil {
			return err
		}
		if t.SessionID != nil || t.SAMLSessionID != nil {
			return ErrInvalidTokenIdentifiers()
		}
	case TokenTypeSAMLAssertion:
		if err := requireNonEmptyID(t.SAMLSessionID, "saml_session_id"); err != nil {
			return err
		}
		if t.SessionID != nil || t.OIDCSessionID != nil {
			return ErrInvalidTokenIdentifiers()
		}
	case TokenTypePersonalAccessToken:
		if t.SessionID != nil || t.OIDCSessionID != nil || t.SAMLSessionID != nil {
			return ErrInvalidTokenIdentifiers()
		}
	case TokenTypeProjectToken, TokenTypeProjectPreview:
		// A project credential authenticates software, not a user, so it
		// carries neither a user nor any session identifier.
		if t.SessionID != nil || t.OIDCSessionID != nil || t.SAMLSessionID != nil {
			return ErrInvalidTokenIdentifiers()
		}
		if t.UserID != "" {
			return ErrInvalidTokenIdentifiers()
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

func (t *Token) JWE(encrypter op.Encrypter) (string, error) {
	payload, err := json.Marshal(t)
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to serialize token payload")
	}

	token, err := encrypter.Encrypt(string(payload))
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to encrypt token payload")
	}

	return token, nil
}

func ParseAndValidateToken(ctx context.Context, token string, decrypter crypto2.DecrypterFactory) (*Token, error) {
	header, err := DecodeJWEHeader(token)
	if err != nil {
		return nil, err
	}

	crypt, err := decrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
	if err != nil {
		return nil, err
	}

	decrypted, err := crypt.Decrypt(token)
	if err != nil {
		return nil, ErrInvalidToken().WithDetails("failed to decrypt")
	}

	payload := new(Token)
	err = json.Unmarshal([]byte(decrypted), payload)
	if err != nil {
		return nil, ErrInvalidToken().WithDetails("failed to unmarshal token payload")
	}

	return payload, nil
}

type JWEHeader struct {
	KeyID               string                 `json:"kid"`
	EncryptionAlgorithm jose.ContentEncryption `json:"enc"`
}

func DecodeJWEHeader(token string) (*JWEHeader, error) {
	headerSeparatorIndex := strings.IndexRune(token, '.')
	if headerSeparatorIndex < 1 {
		return nil, ErrInvalidToken().WithDetails("invalid separator count")
	}
	headerB64 := token[:headerSeparatorIndex]
	headerBs, err := base64.RawURLEncoding.DecodeString(headerB64)
	if err != nil {
		return nil, ErrInvalidToken().WithDetails("invalid base64 header")
	}
	header := &JWEHeader{}
	err = json.Unmarshal(headerBs, header)
	if err != nil {
		return nil, ErrInvalidToken().WithDetails("invalid json header")
	}
	return header, nil
}

func requireNonEmptyID(id *string, name string) error {
	if id == nil || *id == "" {
		return fmt.Errorf("%w: %s is required", ErrInvalidTokenIdentifiers(), name)
	}
	return nil
}

// TokenField enumerates the fields of Token which can be used for filtering and
// ordering in list operations.
type TokenField uint8

const (
	TokenFieldUnspecified TokenField = iota
	TokenFieldProjectID
	TokenFieldTokenID
	TokenFieldUserID
	TokenFieldType
	TokenFieldSessionID
	TokenFieldOIDCSessionID
	TokenFieldSAMLSessionID
	TokenFieldScope
	TokenFieldExpiresAt
	TokenFieldCreatedAt
)
