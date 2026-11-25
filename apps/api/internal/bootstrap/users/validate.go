package users

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
)

// Validate checks a parsed document and password hash encoding.
func Validate(doc *Document, hashValidator crypto.HashValidator) error {
	if doc == nil {
		return fmt.Errorf("document is nil")
	}
	if err := validateHeader(doc.Header); err != nil {
		return fmt.Errorf("header: %w", err)
	}
	if err := validateAttributes(doc.Attributes); err != nil {
		return fmt.Errorf("attributes: %w", err)
	}
	pw, err := parsePasswordAuthenticator(doc.Authenticators)
	if err != nil {
		return fmt.Errorf("authenticators: %w", err)
	}
	if err := hashValidator.ValidateHash(pw.EncodedHash); err != nil {
		return fmt.Errorf("password encoded_hash: %w", err)
	}
	return nil
}

func validateHeader(h Header) error {
	if strings.TrimSpace(h.ProjectID) == "" {
		return fmt.Errorf("project_id is required")
	}
	if strings.TrimSpace(h.SchemaURL) == "" {
		return fmt.Errorf("schema_url is required")
	}
	if strings.TrimSpace(h.ID) == "" {
		return fmt.Errorf("id is required")
	}
	return nil
}

func validateAttributes(attrs map[domain.AttributeKey]json.RawMessage) error {
	if len(attrs) == 0 {
		return fmt.Errorf("attributes must not be empty")
	}
	usernameRaw, ok := attrs[attrKeyUsername]
	if !ok {
		return fmt.Errorf("%q is required", attrKeyUsername)
	}
	username, err := decodeScalarString(usernameRaw, attrKeyUsername)
	if err != nil {
		return err
	}
	if username == "" {
		return fmt.Errorf("%q must be a non-empty string", attrKeyUsername)
	}

	sourceRaw, ok := attrs[attrKeySource]
	if !ok {
		return fmt.Errorf("%q is required", attrKeySource)
	}
	source, err := decodeScalarString(sourceRaw, attrKeySource)
	if err != nil {
		return err
	}
	if source != sourceCLI {
		return fmt.Errorf("%q must be %q", attrKeySource, sourceCLI)
	}

	defaultRaw, ok := attrs[attrKeyDefaultUser]
	if !ok {
		return fmt.Errorf("%q is required", attrKeyDefaultUser)
	}
	var defaultUser bool
	if err := json.Unmarshal(defaultRaw, &defaultUser); err != nil {
		return fmt.Errorf("%q must be a boolean: %w", attrKeyDefaultUser, err)
	}
	if !defaultUser {
		return fmt.Errorf("%q must be true", attrKeyDefaultUser)
	}

	for key, raw := range attrs {
		if _, err := decodeScalar(raw, key); err != nil {
			return err
		}
	}
	return nil
}

func parsePasswordAuthenticator(auths map[domain.AttributeKey]json.RawMessage) (*PasswordAuthenticator, error) {
	if len(auths) == 0 {
		return nil, fmt.Errorf("at least one authenticator is required")
	}
	if len(auths) != 1 {
		keys := make([]domain.AttributeKey, 0, len(auths))
		for k := range auths {
			keys = append(keys, k)
		}
		return nil, fmt.Errorf("only %q authenticator is supported, got keys: %v", authKeyPassword, keys)
	}
	raw, ok := auths[authKeyPassword]
	if !ok {
		return nil, fmt.Errorf("only %q authenticator is supported", authKeyPassword)
	}
	var pw PasswordAuthenticator
	if err := json.Unmarshal(raw, &pw); err != nil {
		return nil, fmt.Errorf("decode %q: %w", authKeyPassword, err)
	}
	if strings.TrimSpace(pw.EncodedHash) == "" {
		return nil, fmt.Errorf("%q.encoded_hash is required", authKeyPassword)
	}
	return &pw, nil
}

func decodeScalarString(raw json.RawMessage, key domain.AttributeKey) (string, error) {
	v, err := decodeScalar(raw, key)
	if err != nil {
		return "", err
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%q must be a string", key)
	}
	return s, nil
}

func decodeScalar(raw json.RawMessage, key domain.AttributeKey) (any, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("%q: %w", key, err)
	}
	switch v.(type) {
	case string, float64, bool:
		return v, nil
	default:
		return nil, fmt.Errorf("%q must be a scalar (string, number, or boolean)", key)
	}
}
