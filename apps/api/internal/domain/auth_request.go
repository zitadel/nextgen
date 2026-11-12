package domain

import "time"

// PrefixAuthRequest prefixes a stored authorization request's id, the handle
// the login page receives as auth_request (ADR 081 §8).
const PrefixAuthRequest ResourcePrefix = "authreq"

// AuthRequest is an authorization request the endpoint validated and stored
// for the login to complete. It records the issuer and the deployment it was
// resolved from, so the flow it opens reads the same release (ADR 081 §10).
type AuthRequest struct {
	ProjectID   string
	ID          string
	ClientID    string
	RedirectURI string
	// State is the client's state, empty when it sent none.
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
}
