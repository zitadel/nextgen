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

func ParseAndValidateToken(ctx context.Context, token string, decrypter crypto2.DecrypterFunc) (*Token, error) {
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
