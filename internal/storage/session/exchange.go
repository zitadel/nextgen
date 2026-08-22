package session

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// UserAgentFingerprintKey is the user_agents.info JSON key for the browser
// fingerprint (UserAgent.ID).
const UserAgentFingerprintKey = "fingerprint"

// StoredCheck is a verified check row used while merging attempt and session
// factors during Exchange.
type StoredCheck struct {
	ID             string
	Type           domain.AuthCheckType
	LastVerifiedAt time.Time
	OnAttempt      bool
}

// HashHandoffToken returns the SHA-256 digest stored on auth_attempts.handoff_token.
func HashHandoffToken(plain string) []byte {
	sum := sha256.Sum256([]byte(plain))
	return sum[:]
}

// ExchangeTTL returns ttl when positive, otherwise SessionAnonymousTTL.
func ExchangeTTL(ttl time.Duration) time.Duration {
	if ttl > 0 {
		return ttl
	}
	return domain.SessionAnonymousTTL
}

// ValidateHandoffAttempt rejects missing, expired, or incomplete handoff state.
func ValidateHandoffAttempt(attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil || attempt.HandedOffAt == nil || attempt.HandedOffAt.IsZero() {
		return domain.ErrSessionInvalidHandoffToken()
	}
	if time.Now().After(attempt.HandoffToken.ExpiresAt(attempt.HandedOffAt)) {
		return domain.ErrSessionInvalidHandoffToken()
	}
	if attempt.IsExpired() {
		return domain.ErrSessionInvalidHandoffToken()
	}
	return nil
}

// FactorClass maps a check type to the class it competes in on a session.
// Passkey enrollment proves the same thing an assertion does for that
// credential, so registration and login share the passkey class; every other
// type is its own class.
func FactorClass(t domain.AuthCheckType) domain.AuthCheckType {
	if t == domain.AuthCheckTypePasskeyRegistration {
		return domain.AuthCheckTypePasskey
	}
	return t
}

// ClassMembers lists the check types competing in t's class, for loser cleanup
// after a promotion.
func ClassMembers(t domain.AuthCheckType) []domain.AuthCheckType {
	if FactorClass(t) == domain.AuthCheckTypePasskey {
		return []domain.AuthCheckType{domain.AuthCheckTypePasskey, domain.AuthCheckTypePasskeyRegistration}
	}
	return []domain.AuthCheckType{t}
}

// PickLastVerifiedByType merges attempt and session verified checks, keeping the
// newest LastVerifiedAt per factor class (attempt wins ties that are strictly after).
func PickLastVerifiedByType(attemptChecks, sessionChecks []StoredCheck) map[domain.AuthCheckType]StoredCheck {
	out := map[domain.AuthCheckType]StoredCheck{}
	for _, c := range sessionChecks {
		out[FactorClass(c.Type)] = c
	}
	for _, c := range attemptChecks {
		existing, ok := out[FactorClass(c.Type)]
		if !ok || c.LastVerifiedAt.After(existing.LastVerifiedAt) {
			out[FactorClass(c.Type)] = c
		}
	}
	return out
}

// NormalizeSessionFactor maps a promoted enrollment factor to the passkey
// class. Sessions record HOW the user authenticated; the ceremony-level
// distinction between registering and asserting a credential stays on the
// attempt.
func NormalizeSessionFactor(check domain.AuthCheck) domain.AuthCheck {
	registration, ok := check.(*domain.AuthFactorPasskeyRegistration)
	if !ok {
		return check
	}
	passkey := &domain.AuthFactorPasskey{
		UserVerified:   registration.UserVerified,
		UserID:         registration.UserID,
		CredentialID:   domain.DecodePasskeyCredentialID(registration.CredentialID),
		BackupEligible: registration.BackupEligible,
		BackupState:    registration.BackupState,
	}
	passkey.SetLastVerifiedAt(registration.GetLastVerifiedAt())
	return passkey
}

// UserAgentFromStoredInfo reconstructs a UserAgent from the user_agents.info map.
func UserAgentFromStoredInfo(info map[string]any) *domain.UserAgent {
	ua := &domain.UserAgent{Info: info}
	if ip, ok := info["ip"].(string); ok {
		ua.IP = ip
	}
	if fp, ok := info[UserAgentFingerprintKey].(string); ok {
		ua.ID = fp
	}
	return ua
}

// AppendFactor replaces an existing factor of the same class or appends a new
// one. Factors are normalized on the way in ([NormalizeSessionFactor]), so a
// promoted enrollment lands as a passkey factor and never coexists with a
// login factor for the same class.
func AppendFactor(sess *domain.Session, factor domain.AuthFactor) {
	normalized, ok := NormalizeSessionFactor(factor).(domain.AuthFactor)
	if !ok {
		return
	}
	for i, f := range sess.Factors {
		if FactorClass(f.Type()) == FactorClass(normalized.Type()) {
			sess.Factors[i] = normalized
			return
		}
	}
	sess.Factors = append(sess.Factors, normalized)
}

// DecodeAuthChecks builds domain auth checks from a stored checks row.
func DecodeAuthChecks(
	checkType domain.AuthCheckType,
	id string,
	lastChallengedAt, lastFailedAt, verifiedAt time.Time,
	failureCount uint16,
	challenge, factor json.RawMessage,
) ([]domain.AuthCheck, error) {
	var checks []domain.AuthCheck
	switch checkType {
	case domain.AuthCheckTypeUser:
		if !verifiedAt.IsZero() {
			userFactor := domain.SetAuthFactorUser(verifiedAt)
			if len(factor) > 0 {
				if err := json.Unmarshal(factor, &userFactor); err != nil {
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
				if err := json.Unmarshal(factor, passkeyFactor); err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check factor payload: %w", err)
				}
			}
			checks = append(checks, passkeyFactor)
		}
		if !lastChallengedAt.IsZero() {
			passkeyCheck := domain.SetAuthChallengePasskey(id, lastChallengedAt, lastFailedAt, failureCount)
			if len(challenge) > 0 {
				if err := json.Unmarshal(challenge, passkeyCheck); err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check challenge payload: %w", err)
				}
			}
			checks = append(checks, passkeyCheck)
		}
	case domain.AuthCheckTypePasskeyRegistration:
		if !verifiedAt.IsZero() {
			registrationFactor := domain.SetAuthFactorPasskeyRegistration(verifiedAt)
			if len(factor) > 0 {
				if err := json.Unmarshal(factor, registrationFactor); err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey registration auth check factor payload: %w", err)
				}
			}
			checks = append(checks, registrationFactor)
		}
		if !lastChallengedAt.IsZero() {
			registrationCheck := domain.SetAuthChallengePasskeyRegistration(id, lastChallengedAt, lastFailedAt, failureCount)
			if len(challenge) > 0 {
				if err := json.Unmarshal(challenge, registrationCheck); err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey registration auth check challenge payload: %w", err)
				}
			}
			checks = append(checks, registrationCheck)
		}
	default:
		return nil, fmt.Errorf("unsupported auth check type %v", checkType)
	}
	return checks, nil
}
