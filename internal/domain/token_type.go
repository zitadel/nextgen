package domain

import (
	"database/sql/driver"
	"errors"
	"fmt"
)

// ErrInvalidTokenType is returned when a token is persisted with [TokenTypeUnspecified].
var ErrInvalidTokenType = errors.New("token type must be a concrete value, not unspecified")

//go:generate go tool enumer -type TokenType -transform snake -trimprefix TokenType
type TokenType uint8

const (
	TokenTypeUnspecified TokenType = iota
	TokenTypeSessionToken
	TokenTypeOIDCAccessToken
	TokenTypeSAMLAssertion
	TokenTypePersonalAccessToken
)

// Persistable reports whether t may be written to storage. [TokenTypeUnspecified] is never persistable.
func (t TokenType) Persistable() bool {
	return t != TokenTypeUnspecified
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
