// Package authattempt holds shared helpers for auth-attempt statement dialects.
package authattempt

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// CheckCreate is the JSON shape used when inserting checks alongside an attempt.
type CheckCreate struct {
	Type             uint8           `json:"type"`
	ChallengePayload json.RawMessage `json:"challenge_payload,omitempty"`
	FactorPayload    json.RawMessage `json:"factor_payload,omitempty"`
	IsChallenge      bool            `json:"is_challenge"`
	IsFactor         bool            `json:"is_factor"`
}

// ChecksToJSON marshals domain checks into the create payload shape.
func ChecksToJSON(checks []domain.AuthCheck) ([]byte, error) {
	checkRows := make([]CheckCreate, 0, len(checks))
	for _, check := range checks {
		checkRow := CheckCreate{Type: uint8(check.Type())}
		if challenge, ok := check.(domain.AuthChallenge); ok {
			checkRow.IsChallenge = true
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

// NewAuthChecks reconstructs domain checks from a stored check row.
func NewAuthChecks(
	checkType domain.AuthCheckType,
	id string,
	lastChallengedAt, lastFailedAt, verifiedAt time.Time,
	failureCount uint16,
	challenge, factor json.RawMessage,
) (checks []domain.AuthCheck, err error) {
	switch checkType {
	case domain.AuthCheckTypeUser:
		if !verifiedAt.IsZero() {
			userFactor := domain.SetAuthFactorUser(verifiedAt)
			if len(factor) > 0 {
				err = json.Unmarshal(factor, &userFactor)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal user auth check factor payload: %w", err)
				}
			}
			checks = append(checks, userFactor)
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.SetAuthChallengeUser(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePassword:
		if !verifiedAt.IsZero() {
			checks = append(checks, domain.SetAuthFactorPassword(verifiedAt))
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.SetAuthChallengePassword(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePasskey:
		if !verifiedAt.IsZero() {
			passkeyFactor := domain.SetAuthFactorPasskey(verifiedAt)
			if len(factor) > 0 {
				err = json.Unmarshal(factor, passkeyFactor)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check factor payload: %w", err)
				}
			}
			checks = append(checks, passkeyFactor)
		}
		if !lastChallengedAt.IsZero() {
			passkeyCheck := domain.SetAuthChallengePasskey(id, lastChallengedAt, lastFailedAt, failureCount)
			if len(challenge) > 0 {
				err = json.Unmarshal(challenge, passkeyCheck)
				if err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check challenge payload: %w", err)
				}
			}
			checks = append(checks, passkeyCheck)
		}
	default:
		slog.Error("unsupported auth check type", slog.Any("check_type", checkType))
	}
	return checks, nil
}

// SessionIDArg converts an optional session ID string to a storage Identity string.
func SessionIDArg(sessionID *string) string {
	if sessionID == nil {
		return ""
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
