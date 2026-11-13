package domain

import "time"

const (
	// PrefixAuthRequest prefixes a stored authorization request's id, the
	// handle the login page receives as auth_request (ADR 081 §8).
	PrefixAuthRequest ResourcePrefix = "authreq"
	// AuthRequestTTL is how long a request and its binding cookie live: as
	// long as a sign-in flow (AuthAttemptTTL), since a request is only needed
	// while the sign-in it starts is running.
	AuthRequestTTL = AuthAttemptTTL
)

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
