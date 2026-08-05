// Package authattempt holds shared helpers for auth-attempt statement dialects.
package authattempt

import (
	"encoding/json"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// CheckCreate is the JSON shape used when inserting checks alongside an attempt.
type CheckCreate struct {
	ID               string          `json:"id"`
	Type             uint8           `json:"type"`
	ChallengePayload json.RawMessage `json:"challenge_payload,omitempty"`
	FactorPayload    json.RawMessage `json:"factor_payload,omitempty"`
	IsChallenge      bool            `json:"is_challenge"`
	IsFactor         bool            `json:"is_factor"`
}

// ChecksToJSON marshals domain checks into the create payload shape.
// ids must be one dialect-minted check id per check (same length as checks).
func ChecksToJSON(checks []domain.AuthCheck, ids []string) ([]byte, error) {
	if len(ids) != len(checks) {
		return nil, fmt.Errorf("checksToJSON: id count %d != check count %d", len(ids), len(checks))
	}
	checkRows := make([]CheckCreate, 0, len(checks))
	for i, check := range checks {
		checkRow := CheckCreate{ID: ids[i], Type: uint8(check.Type())}
		if challenge, ok := check.(domain.AuthChallenge); ok {
			checkRow.IsChallenge = true
			challenge.SetID(ids[i])
			var err error
			checkRow.ChallengePayload, err = json.Marshal(challenge.Payload())
			if err != nil {
				return nil, fmt.Errorf("failed to marshal challenge payload: %w", err)
			}
		}
		if factor, ok := check.(domain.AuthFactor); ok {
			checkRow.IsFactor = true
			var err error
			checkRow.FactorPayload, err = json.Marshal(factor.Payload())
			if err != nil {
				return nil, fmt.Errorf("failed to marshal factor payload: %w", err)
			}
		}
		checkRows = append(checkRows, checkRow)
	}

	checkRowsJSON, err := json.Marshal(checkRows)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal auth attempt checks: %w", err)
	}
	return checkRowsJSON, nil
}

// SessionIDArg converts an optional session ID string for SQL binding.
func SessionIDArg(sessionID *string) any {
	if sessionID == nil || *sessionID == "" {
		return nil
	}
	return *sessionID
}

// MarshalPayloadJSON marshals a challenge or factor payload, returning nil when empty.
func MarshalPayloadJSON(payload any) (json.RawMessage, error) {
	if payload == nil {
		return nil, nil
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// MarshalPayloadString marshals a payload to a Spanner JSON string pointer.
func MarshalPayloadString(payload any) (*string, error) {
	b, err := MarshalPayloadJSON(payload)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, nil
	}
	s := string(b)
	return &s, nil
}
