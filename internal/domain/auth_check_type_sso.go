package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"log/slog"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
)

// ErrSSOStateInvalid covers every way a presented SSO state fails to resolve:
// unknown, already consumed, superseded by a re-issue, or belonging to an
// expired attempt. One code and one message for all of them, so a caller
// cannot probe which states exist.
func ErrSSOStateInvalid() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("sso_state_invalid"), "The SSO state is not valid.", nil, nil)
}

// SSOStatePayload is the pending half of an SSO callback record
// (challenge_payload): what the submit step has to hand back to itself when
// the provider redirects, keyed only by the state hash.
type SSOStatePayload struct {
	ProviderSlug         string `json:"provider_slug"`
	ConnectionRevisionID string `json:"connection_revision_id"`
	BindingNonce         string `json:"binding_nonce"`
	// EncryptedPKCEVerifier is AES-GCM ciphertext, empty when the connection
	// runs without PKCE. The verifier travels to the provider's token endpoint
	// later, so it cannot be stored in the clear (ADR 029, data at rest).
	EncryptedPKCEVerifier string `json:"encrypted_pkce_verifier,omitempty"`
	OIDCNonce             string `json:"oidc_nonce"`
	ReturnTarget          string `json:"return_target"`
}

// DecryptPKCEVerifier returns the plaintext verifier for the token exchange,
// or "" when the record was issued without PKCE. Call it only after
// ConsumeSSOState succeeded. Services pass the crypter the issue used:
// keys.GetProjectCrypter(ctx, projectID, EncryptionKeyPurposeSecret).
func (p SSOStatePayload) DecryptPKCEVerifier(dec crypto.Decrypter) (string, error) {
	if p.EncryptedPKCEVerifier == "" {
		return "", nil
	}
	verifier, err := dec.Decrypt(p.EncryptedPKCEVerifier)
	if err != nil {
		return "", ErrDecryptionFailed(err)
	}
	return verifier, nil
}

// LogValue implements [slog.LogValuer]. The nonces and the PKCE verifier are
// replay material, so only the non-secret routing fields are logged.
//
// The receiver is a value so that both SSOStatePayload and *SSOStatePayload
// redact. With a pointer receiver the value form is not a [slog.LogValuer], so
// the handler reflects over the struct and prints every field in it.
func (p SSOStatePayload) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("provider_slug", p.ProviderSlug),
		slog.String("connection_revision_id", p.ConnectionRevisionID),
		slog.String("return_target", p.ReturnTarget),
		slog.Bool("pkce", p.EncryptedPKCEVerifier != ""),
	)
}

// SSOCallbackResult is what the provider asserted, stored on the consumed
// record (factor_payload). It deliberately carries no token and no
// authorization code: the exchange is done by the time this is written.
type SSOCallbackResult struct {
	Subject              string         `json:"subject"`
	ConnectionRevisionID string         `json:"connection_revision_id"`
	Claims               map[string]any `json:"claims,omitempty"`
}

// LogValue implements [slog.LogValuer]. Claims may hold personal data, so the
// log carries only the subject and the connection revision. Value receiver for
// the reason given on [SSOStatePayload.LogValue].
func (r SSOCallbackResult) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("subject", r.Subject),
		slog.String("connection_revision_id", r.ConnectionRevisionID),
	)
}

// SSOCallbackCheck is the single-use state record bridging the submit step and
// the provider callback. It is an [AuthCheck] and nothing more: not an
// [AuthFactor], so no exchange, completeness or wire-rendering path can read
// it, and not an [AuthChallenge], so the generic challenge and proof endpoints
// cannot reach it either.
type SSOCallbackCheck struct {
	// ID is HashSecret(state): the plaintext state travels to the provider and
	// back, only its hash is stored.
	ID string
	// AuthAttemptID is filled by IssueSSOState and by ConsumeSSOState, which is
	// how the callback learns the attempt from the state alone.
	AuthAttemptID string
	// IssuedAt mirrors last_challenged_at and is zero once consumed.
	IssuedAt time.Time
	// Pending is what the callback needs: set by NewSSOState and by every
	// IssueSSOState, cleared when ConsumeSSOState burns the record.
	Pending *SSOStatePayload
	// Result is what the provider asserted: nil until SetSSOCallbackResult
	// stores it, and cleared again by a re-issue.
	Result *SSOCallbackResult
}

func (c *SSOCallbackCheck) Type() AuthCheckType { return AuthCheckTypeSSOCallback }

func (c *SSOCallbackCheck) Payload() any { return c.Pending }

// LogValue implements [slog.LogValuer]. The id is the stored hash, so it is
// safe to log; the payloads are summarised as presence flags. Value receiver
// for the reason given on [SSOStatePayload.LogValue].
func (c SSOCallbackCheck) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("id", c.ID),
		slog.Time("issued_at", c.IssuedAt),
		slog.Bool("pending", c.Pending != nil),
		slog.Bool("has_result", c.Result != nil),
	)
}

// Deliberately not an AuthFactor and not an AuthChallenge.
var _ AuthCheck = (*SSOCallbackCheck)(nil)

// SSOState is what NewSSOState hands the submit step: the two plaintext
// secrets the authorize request needs and the record to persist. Neither
// plaintext is ever stored: State is only stored as its hash, the verifier
// only as AES-GCM ciphertext (ADR 029, data at rest).
type SSOState struct {
	State        string            // plaintext state, goes to the provider
	PKCEVerifier string            // plaintext verifier for PKCEChallenge; empty when PKCE is off
	Check        *SSOCallbackCheck // ready for IssueSSOState
}

// LogValue implements [slog.LogValuer]. Both plaintext secrets stay out of the
// log; only the record summary and whether PKCE is in play are reported.
func (s SSOState) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Any("check", s.Check),
		slog.Bool("pkce", s.PKCEVerifier != ""),
	)
}

// NewSSOState mints the secrets. Every value is crypto/rand and base64url: the
// state (16 bytes), the binding nonce (16 bytes), the OIDC nonce (16 bytes) and
// the PKCE verifier (32 bytes, the 43-character form RFC 7636 §4.1 recommends).
//
// pkceEncrypter nil means PKCE is disabled for this connection: no verifier is
// minted. Otherwise the verifier is encrypted with it before it is placed on
// the record, because it later travels to the provider's token endpoint and so
// cannot be stored in the clear (ADR 029, data at rest). Services pass
// keys.GetProjectCrypter(ctx, projectID, EncryptionKeyPurposeSecret), the same
// crypter secret variables use.
//
// Only the state's hash becomes the record id, so the plaintext is the single
// thing that can find the record again.
func NewSSOState(providerSlug, connectionRevisionID, returnTarget string, pkceEncrypter crypto.Encrypter) (*SSOState, error) {
	state, err := randomSecret(16)
	if err != nil {
		return nil, err
	}
	bindingNonce, err := randomSecret(16)
	if err != nil {
		return nil, err
	}
	oidcNonce, err := randomSecret(16)
	if err != nil {
		return nil, err
	}
	var verifier, encryptedVerifier string
	if pkceEncrypter != nil {
		if verifier, err = randomSecret(32); err != nil {
			return nil, err
		}
		if encryptedVerifier, err = pkceEncrypter.Encrypt(verifier); err != nil {
			return nil, ErrEncryptionFailed(err)
		}
	}
	return &SSOState{
		State:        state,
		PKCEVerifier: verifier,
		Check: &SSOCallbackCheck{
			ID: HashSecret(state),
			Pending: &SSOStatePayload{
				ProviderSlug:          providerSlug,
				ConnectionRevisionID:  connectionRevisionID,
				BindingNonce:          bindingNonce,
				EncryptedPKCEVerifier: encryptedVerifier,
				OIDCNonce:             oidcNonce,
				ReturnTarget:          returnTarget,
			},
		},
	}, nil
}

// PKCEChallenge derives the S256 code challenge from a verifier
// (RFC 7636 §4.2): base64url of the SHA-256 digest, unpadded.
func PKCEChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomSecret(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", ErrInternal(err).WithMessage("failed to generate SSO state secret")
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
