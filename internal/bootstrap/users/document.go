package users

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/zitadel/nextgen/internal/domain"
)

// Document is the on-disk shape for a single bootstrap user (one file per user).
type Document struct {
	Header         Header                                  `json:"header"`
	Attributes     map[domain.AttributeKey]json.RawMessage `json:"attributes"`
	Authenticators map[domain.AttributeKey]json.RawMessage `json:"authenticators"`
}

// Header holds users-table metadata.
type Header struct {
	ProjectID string `json:"project_id"`
	TeamID    string `json:"team_id,omitempty"`
	SchemaURL string `json:"schema_url"`
	ID        string `json:"id"`
}

// PasswordAuthenticator is the only supported authenticator for bootstrap import.
type PasswordAuthenticator struct {
	EncodedHash    string `json:"encoded_hash"`
	ChangeRequired bool   `json:"change_required"`
}

const (
	attrKeyUsername    = "username"
	attrKeySource      = "zitadel.source"
	attrKeyDefaultUser = "zitadel.default_user"

	authKeyPassword = "password"
	sourceCLI       = "cli"
)

// ParseFile reads and decodes a bootstrap user JSON file.
func ParseFile(path string) (*Document, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	var doc Document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("decode json: %w", err)
	}
	return &doc, nil
}
