package domain

import (
	"strings"
	"time"
)

const (
	// PrefixAuthRequest prefixes a stored authorization request's id, the
	// handle the login page receives as auth_request (ADR 081 §8).
	PrefixAuthRequest ResourcePrefix = "authreq"
	// AuthRequestTTL is how long a request's binding cookie lives, and how
	// far ahead its row's expires_at is set. Nothing refuses or deletes an
	// expired row yet. It is one authentication attempt's lifetime for now; a
	// flow that keeps moving has no fixed length.
	AuthRequestTTL = AuthAttemptTTL
	// AuthCodeTTL is how long an authorization code can be redeemed.
	AuthCodeTTL = time.Minute
	// AccessTokenTTL is the lifetime of an access token a code is redeemed for.
	AccessTokenTTL = 5 * time.Minute
)

// ErrAuthCodeInvalid refuses a code that is unknown, expired or already
// redeemed, or that the request does not allow to redeem.
func ErrAuthCodeInvalid() Error {
	return newError(PrefixAuthRequest.ErrorCodePrefix("code_invalid"), "auth request: the authorization code is invalid", nil, nil)
}

// ErrAuthCodeRedirectURIMismatch refuses a redemption whose redirect_uri is
// not the one of the authorization request.
func ErrAuthCodeRedirectURIMismatch() Error {
	return newError(PrefixAuthRequest.ErrorCodePrefix("redirect_uri_mismatch"), "auth request: the redirect_uri does not match the authorization request", nil, nil)
}

// ErrAuthCodeVerifierMissing refuses a redemption without a code_verifier
// for a request that sent a code_challenge.
func ErrAuthCodeVerifierMissing() Error {
	return newError(PrefixAuthRequest.ErrorCodePrefix("code_verifier_missing"), "auth request: the code_verifier is missing", nil, nil)
}

// ErrAuthCodeVerifierInvalid refuses a code_verifier that does not match the
// request's code_challenge.
func ErrAuthCodeVerifierInvalid() Error {
	return newError(PrefixAuthRequest.ErrorCodePrefix("code_verifier_invalid"), "auth request: the code_verifier does not match the code_challenge", nil, nil)
}

// ErrAuthCodeVerifierUnexpected refuses a code_verifier for a request that
// sent no code_challenge.
func ErrAuthCodeVerifierUnexpected() Error {
	return newError(PrefixAuthRequest.ErrorCodePrefix("code_verifier_unexpected"), "auth request: a code_verifier was sent, but the authorization request has no code_challenge", nil, nil)
}

// ErrAuthCodeNotIssued reports that no code was issued: the request is
// unknown or already has a code.
func ErrAuthCodeNotIssued() Error {
	return newError(PrefixAuthRequest.ErrorCodePrefix("code_not_issued"), "auth request: the request is unknown or already has a code", nil, nil)
}

// AuthRequest is an authorization request the endpoint validated and stored
// for the login to complete. It records the issuer and the deployment it was
// resolved from, so the flow it opens reads the same release (ADR 081 §10).
type AuthRequest struct {
	ProjectID   string
	ID          string
	ClientID    string
	RedirectURI string
	// State is the client's state.
	State  string
	Scopes []string
	// CodeChallenge is the S256 PKCE challenge, empty without PKCE.
	CodeChallenge string
	Issuer        string
	DeploymentID  string
	ReleaseID     string
	// BindingHash is the hash of the nonce in the cookie that binds the
	// request to the browser that started it (ADR 081 §8.3).
	BindingHash string
	CreatedAt   time.Time
	ExpiresAt   time.Time
	// CodeHash is the HashSecret of the authorization code the login issued,
	// empty until it issues one. UserID and SessionID are who the code signs
	// in, and CodeExpiresAt ends it.
	CodeHash      string
	UserID        string
	SessionID     string
	CodeExpiresAt *time.Time
	// CorrelationID is the chain of requests the authorization request
	// starts: the flow created for it and the redemption of its code join it
	// (ADR 048, amendment of 2026-11-26). Empty for a request stored before
	// chains.
	CorrelationID string
}

// NewAuthRequestBinding mints the nonce of the cookie that binds a request to
// its browser: 16 random bytes, of which only the HashSecret is stored.
func NewAuthRequestBinding() (nonce, hash string, err error) {
	nonce, err = randomSecret(16)
	if err != nil {
		return "", "", err
	}
	return nonce, HashSecret(nonce), nil
}

// NewAuthCode generates an authorization code, `<deploymentID>.<random>`
// with 32 random bytes, or the random part alone without a deployment. Only
// the HashSecret of the whole code is stored, so a changed prefix finds no
// request. The prefix tells the token endpoint which deployment serves the
// client; it is not a secret. Neither part can hold a `.`: the random part
// is base64url, and a deployment ID is `dep_` and a ULID or UUID.
func NewAuthCode(deploymentID string) (code, hash string, err error) {
	code, err = randomSecret(32)
	if err != nil {
		return "", "", err
	}
	if deploymentID != "" {
		code = deploymentID + "." + code
	}
	return code, HashSecret(code), nil
}

// AuthCodeDeploymentID is the deployment a code names, the text before its
// first `.`, or empty when it has none.
func AuthCodeDeploymentID(code string) string {
	deploymentID, _, _ := strings.Cut(code, ".")
	if deploymentID == code {
		return ""
	}
	return deploymentID
}
