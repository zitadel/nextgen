package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"log/slog"
	"time"
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
	PKCEVerifier         string `json:"pkce_verifier,omitempty"`
	OIDCNonce            string `json:"oidc_nonce"`
	ReturnTarget         string `json:"return_target"`
}

// LogValue implements [slog.LogValuer]. The nonces and the PKCE verifier are
// replay material, so only the non-secret routing fields are logged.
func (p *SSOStatePayload) LogValue() slog.Value {
	if p == nil {
		return slog.Value{}
	}
	return slog.GroupValue(
		slog.String("provider_slug", p.ProviderSlug),
		slog.String("connection_revision_id", p.ConnectionRevisionID),
		slog.String("return_target", p.ReturnTarget),
		slog.Bool("pkce", p.PKCEVerifier != ""),
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
// log carries only the subject and the connection revision.
func (r *SSOCallbackResult) LogValue() slog.Value {
	if r == nil {
		return slog.Value{}
	}
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
	// AuthAttemptID is filled when the record is consumed; the callback
	// carries the state alone.
	AuthAttemptID string
	// IssuedAt mirrors last_challenged_at and is zero once consumed.
	IssuedAt time.Time
	// Pending is nil once consumed.
	Pending *SSOStatePayload
	// Result is nil until the exchange stored it.
	Result *SSOCallbackResult
}

func (c *SSOCallbackCheck) Type() AuthCheckType { return AuthCheckTypeSSOCallback }

func (c *SSOCallbackCheck) Payload() any { return c.Pending }

// LogValue implements [slog.LogValuer]. The id is the stored hash, so it is
// safe to log; the payloads are summarised as presence flags.
func (c *SSOCallbackCheck) LogValue() slog.Value {
	if c == nil {
		return slog.Value{}
	}
	return slog.GroupValue(
		slog.String("id", c.ID),
		slog.Time("issued_at", c.IssuedAt),
		slog.Bool("pending", c.Pending != nil),
		slog.Bool("has_result", c.Result != nil),
	)
}

// Deliberately not an AuthFactor and not an AuthChallenge.
var _ AuthCheck = (*SSOCallbackCheck)(nil)

// NewSSOState mints the plaintext state and the record it keys. Every value is
// crypto/rand and base64url: the state (16 bytes), the binding nonce (16
// bytes), the OIDC nonce (16 bytes) and, when pkce is set, the PKCE verifier
// (32 bytes, the 43-character form RFC 7636 §4.1 recommends).
//
// Only the state's hash becomes the record id, so the plaintext is the single
// thing that can find the record again.
func NewSSOState(providerSlug, connectionRevisionID, returnTarget string, pkce bool) (string, *SSOCallbackCheck, error) {
	state, err := randomSecret(16)
	if err != nil {
		return "", nil, err
	}
	bindingNonce, err := randomSecret(16)
	if err != nil {
		return "", nil, err
	}
	oidcNonce, err := randomSecret(16)
	if err != nil {
		return "", nil, err
	}
	var verifier string
	if pkce {
		if verifier, err = randomSecret(32); err != nil {
			return "", nil, err
		}
	}
	return state, &SSOCallbackCheck{
		ID: HashSecret(state),
		Pending: &SSOStatePayload{
			ProviderSlug:         providerSlug,
			ConnectionRevisionID: connectionRevisionID,
			BindingNonce:         bindingNonce,
			PKCEVerifier:         verifier,
			OIDCNonce:            oidcNonce,
			ReturnTarget:         returnTarget,
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
