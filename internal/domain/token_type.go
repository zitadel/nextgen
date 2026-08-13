package domain

import (
	"database/sql/driver"
	"errors"
	"fmt"
)

// ErrInvalidTokenType is returned when a token type cannot be stored (see [TokenType.Persistable]).
var ErrInvalidTokenType = errors.New("token type is not persistable")

//go:generate go tool enumer -type TokenType -transform snake -trimprefix TokenType -json
type TokenType uint8

const (
	TokenTypeUnspecified TokenType = iota
	TokenTypeSessionToken
	TokenTypeOIDCAccessToken
	TokenTypeSAMLAssertion
	TokenTypePersonalAccessToken
	// TokenTypeFlow is carried in a flow-engine cookie; it is not stored and must not be used as a bearer token.
	TokenTypeFlow
	// TokenTypeJWTProfile is a self-signed JWT verified with a stored public key; it is not stored but may be used as a bearer token.
	TokenTypeJWTProfile
	// TokenTypeProjectToken is the confidential-plane project secret (ADR 036)
	TokenTypeProjectToken
	// TokenTypeProjectPreview is the read-only preview credential issued
	// alongside the project secret.
	TokenTypeProjectPreview
)

// Persistable reports whether t may be written to the tokens table.
func (t TokenType) Persistable() bool {
	switch t {
	case TokenTypeUnspecified:
		return false
	case TokenTypeSessionToken:
		return true
	case TokenTypeOIDCAccessToken:
		return true
	case TokenTypeSAMLAssertion:
		return true
	case TokenTypePersonalAccessToken:
		return true
	case TokenTypeFlow:
		return false
	case TokenTypeJWTProfile:
		return false
	case TokenTypeProjectToken:
		return true
	case TokenTypeProjectPreview:
		return true
	default:
		return false
	}
}

func (t TokenType) Value() (driver.Value, error) {
	if !t.Persistable() {
		return nil, ErrInvalidTokenType
	}
	return t.String(), nil
}

func (t *TokenType) Scan(value any) error {
	if value == nil {
		return fmt.Errorf("token_type is required")
	}
	var str string
	switch v := value.(type) {
	case []byte:
		str = string(v)
	case string:
		str = v
	case fmt.Stringer:
		str = v.String()
	default:
		return fmt.Errorf("invalid token_type value type %T", value)
	}
	parsed, err := TokenTypeString(str)
	if err != nil {
		return err
	}
	if !parsed.Persistable() {
		return ErrInvalidTokenType
	}
	*t = parsed
	return nil
}
