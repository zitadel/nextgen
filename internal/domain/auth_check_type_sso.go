package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
)

// ssoStateSeparator splits the project id from the random part of a state.
// Both sides keep it out of their own alphabet: resource ids are
// prefix-underscore-body (resource.go) and the random part is base64url.
const ssoStateSeparator = "."

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
	// RedirectURI is the authorize request's redirect_uri, which the token
	// exchange must repeat unchanged (RFC 6749 §4.1.3). The callback cannot
	// rebuild it from its own request: behind a dev proxy the host it sees is
	// not the browser origin the submit was bound to.
	RedirectURI string `json:"redirect_uri"`
	// BindingNonceHash is HashSecret of the nonce the browser holds in its
	// __Host- cookie. The record only ever verifies it, so a hash is all it
	// needs (ADR 029, verify-only values).
	BindingNonceHash string `json:"binding_nonce_hash"`
	// EncryptedPKCEVerifier is AES-GCM ciphertext, empty when the connection
	// runs without PKCE. The verifier travels to the provider's token endpoint
	// later, so it cannot be stored in the clear (ADR 029, data at rest).
	EncryptedPKCEVerifier string `json:"encrypted_pkce_verifier,omitempty"`
	// OIDCNonce is the nonce sent in the authorize request, as issued. Unlike
	// the binding nonce it is not verify-only: the id_token verifier takes the
	// value and compares it with the token's nonce claim in one pass with the
	// other checks, so a hash would leave the callback nothing to pass.
	OIDCNonce    string `json:"oidc_nonce"`
	ReturnTarget string `json:"return_target"`
}

// MatchesBindingNonce reports whether plain is the nonce this record was issued
// with. The callback compares the browser's cookie value through this, never by
// reading the stored field. Empty plain never matches, so a missing cookie
// cannot pass.
func (p SSOStatePayload) MatchesBindingNonce(plain string) bool {
	if plain == "" || p.BindingNonceHash == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(HashSecret(plain)), []byte(p.BindingNonceHash)) == 1
}

// DecryptPKCEVerifier returns the plaintext verifier for the token exchange,
// or "" when the record was issued without PKCE. Call it only after
// ConsumeSSOState succeeded.
//
// dec must resolve the key from the ciphertext's own kid, the way
// decrypterOfWritingKey in internal/service/variables.go does, never from the
// project's currently active secret key. The ceremony lives up to the attempt
// TTL, so a key rotation in between would otherwise strand it.
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
// replay material, so only the non-secret routing fields are logged. For the
// OIDC nonce, stored in the clear, this list is the only thing keeping it off
// the log.
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
	// Verified records, per user-schema property, whether the provider asserted
	// the property's mapped claim as verified (for example email_verified). It
	// is keyed like Claims, the same as idp.ExternalIdentity.Verified.
	Verified map[string]bool `json:"verified,omitempty"`
	// ErrorKey is set when the ceremony failed after the state was consumed:
	// [FlowStepErrorSSOCancelled] when the provider reported access_denied,
	// [FlowStepErrorSSOFailed] for every other failure. The provider's own
	// error text goes to the server log only, never into the record. An error
	// result carries only this key: no subject, no claims, no verified map.
	ErrorKey string `json:"error_key,omitempty"`
	// CollisionUserID is written by a collision bind in the same transaction as
	// the user factor, and replaces the whole result: after a collision the row
	// holds only this marker, and the provider's subject and claims are gone.
	// It is the only signal a later render reconciles a lost collision cookie
	// from.
	CollisionUserID string `json:"collision_user_id,omitempty"`
}

// IsError reports whether the ceremony failed; see [SSOCallbackResult.ErrorKey].
func (r SSOCallbackResult) IsError() bool { return r.ErrorKey != "" }

// LogValue implements [slog.LogValuer]. Claims may hold personal data, so the
// log carries only the subject and the non-personal routing fields. Value
// receiver for the reason given on [SSOStatePayload.LogValue].
func (r SSOCallbackResult) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("subject", r.Subject),
		slog.String("connection_revision_id", r.ConnectionRevisionID),
		slog.String("error_key", r.ErrorKey),
	)
}

// SSOCallbackCheck is the single-use state record bridging the submit step and
// the provider callback. It is an [AuthCheck] and nothing more: not an
// [AuthFactor], so no exchange, completeness or wire-rendering path can read
// it, and not an [AuthChallenge], so the generic challenge and proof endpoints
// cannot reach it either.
type SSOCallbackCheck struct {
	// ID is the dialect-minted check id (ADR 047). NewSSOState leaves it empty
	// and IssueSSOState assigns it.
	ID string
	// StateHash is HashSecret(state), the callback's only lookup key: it is
	// stored in checks.lookup_hash, set by NewSSOState and filled by
	// ConsumeSSOState. Attempt reads leave it empty, since nothing that reads an
	// attempt looks a record up by state.
	StateHash string
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

// LogValue implements [slog.LogValuer]. The minted id is safe to log; the state
// hash and the payloads are reported as presence flags only. Value receiver for
// the reason given on [SSOStatePayload.LogValue].
func (c SSOCallbackCheck) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("id", c.ID),
		slog.Time("issued_at", c.IssuedAt),
		slog.Bool("has_state_hash", c.StateHash != ""),
		slog.Bool("pending", c.Pending != nil),
		slog.Bool("has_result", c.Result != nil),
	)
}

// Deliberately not an AuthFactor and not an AuthChallenge.
var _ AuthCheck = (*SSOCallbackCheck)(nil)

// AuthFactorSSO records that the attempt was authenticated through an identity
// provider: which connection, and which identity link resolved the user. It
// carries no subject, no claims and no provider token, so promoting it into a
// session copies nothing the provider asserted.
type AuthFactorSSO struct {
	ConnectionID string `json:"connection_id"`
	LinkID       string `json:"link_id"`
	// AttemptID is the attempt that wrote the factor; a copy promoted through a
	// session keeps the original id, so only this attempt's own bind counts as
	// a retry marker.
	AttemptID string `json:"attempt_id"`
	authFactor
}

func (a *AuthFactorSSO) Type() AuthCheckType { return AuthCheckTypeSSO }

func (a *AuthFactorSSO) Payload() any { return a }

var _ AuthFactor = (*AuthFactorSSO)(nil)

// SSOState is what NewSSOState hands the submit step: the four plaintext
// secrets it needs and the record to persist. The state becomes the record's
// lookup hash, the binding nonce a hash in the payload, the verifier AES-GCM
// ciphertext (ADR 029). Only the OIDC nonce is stored as issued, because the
// callback has to hand the value to the id_token verifier.
type SSOState struct {
	State        string            // plaintext state, goes to the provider
	PKCEVerifier string            // plaintext verifier for PKCEChallenge; empty when PKCE is off
	BindingNonce string            // plaintext nonce for the browser's __Host- cookie
	OIDCNonce    string            // plaintext nonce for the authorize request
	Check        *SSOCallbackCheck // ready for IssueSSOState
}

// LogValue implements [slog.LogValuer]. Every plaintext secret stays out of the
// log; only the record summary and whether PKCE is in play are reported.
func (s SSOState) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Any("check", s.Check),
		slog.Bool("pkce", s.PKCEVerifier != ""),
	)
}

// NewSSOState mints the state "<projectID>.<random>" and the other secrets.
// Every secret is crypto/rand and base64url: the state's random part (16
// bytes), the binding nonce (16 bytes), the OIDC nonce (16 bytes) and the PKCE
// verifier (32 bytes, the 43-character form RFC 7636 §4.1 recommends). State
// and the binding nonce reach the record only as their HashSecret digests. The
// OIDC nonce is stored as issued. The record's own id is left to the storage
// layer (ADR 047).
//
// pkceEncrypter nil means PKCE is disabled for this connection: no verifier is
// minted. Otherwise the verifier is encrypted with it before it is placed on
// the record, because it later travels to the provider's token endpoint and so
// cannot be stored in the clear (ADR 029, data at rest). Services pass
// keys.GetProjectCrypter(ctx, projectID, EncryptionKeyPurposeSecret), the same
// crypter secret variables use. Its ciphertext is a compact JWE carrying the
// writing key's id, which is what lets the callback decrypt after a rotation
// (see [SSOStatePayload.DecryptPKCEVerifier]).
func NewSSOState(projectID, providerSlug, connectionRevisionID, redirectURI, returnTarget string, pkceEncrypter crypto.Encrypter) (*SSOState, error) {
	if projectID == "" {
		return nil, ErrInternal(errors.New("sso state: project id is empty"))
	}
	random, err := randomSecret(16)
	if err != nil {
		return nil, err
	}
	// The [SSOCallbackCheck] row is found by (project_id, lookup_hash), and the
	// provider's redirect is the one request with no other project source: the
	// flow cookie is SameSite=Strict and is not sent on a cross-site
	// navigation, and there is no project header or body. The state is the only
	// value the provider echoes back, so the project rides in it, read out
	// again by [SSOStateProjectID]. The project id is not a secret (the client
	// sends it in CreateFlow), and the random part keeps its full entropy.
	// Resource ids never hold the separator (resource.go); stripping it keeps
	// the parse exact rather than truncated if that ever changes.
	state := strings.ReplaceAll(projectID, ssoStateSeparator, "") + ssoStateSeparator + random
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
		BindingNonce: bindingNonce,
		OIDCNonce:    oidcNonce,
		Check: &SSOCallbackCheck{
			// The hash is over the full state, prefix included: a state with
			// a swapped project prefix matches no stored hash.
			StateHash: HashSecret(state),
			Pending: &SSOStatePayload{
				ProviderSlug:          providerSlug,
				ConnectionRevisionID:  connectionRevisionID,
				RedirectURI:           redirectURI,
				BindingNonceHash:      HashSecret(bindingNonce),
				EncryptedPKCEVerifier: encryptedVerifier,
				OIDCNonce:             oidcNonce,
				ReturnTarget:          returnTarget,
			},
		},
	}, nil
}

// SSOStateProjectID reads the project id back out of a presented state, so the
// callback can scope its lookup. The input is attacker-controlled: a state
// without the separator, or with an empty part, reads as "", and the caller
// treats it exactly like an unknown state. The project id is only a routing
// hint until ConsumeSSOState matches the full string's hash.
func SSOStateProjectID(state string) string {
	projectID, random, ok := strings.Cut(state, ssoStateSeparator)
	if !ok || projectID == "" || random == "" {
		return ""
	}
	return projectID
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
