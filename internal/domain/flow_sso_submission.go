package domain

import "context"

// FlowSSOAuthorizer starts the hand-off to an identity provider.
//
// Pressing a provider button is the reserved `sso` action. The engine owns
// the routing decision -- which step offered the button, and which step the
// flow sits on while the browser is away -- but not the protocol: minting the
// state and nonce, encrypting the PKCE verifier, recording the pending
// callback and building the authorize URL all belong to the identity layer
// (`internal/idp`) over the connection the slug names. This port is the seam
// between the two.
//
// The engine calls it once per submission and renders what it returns; it
// never retries. A failure surfaces to the client as the step's error rather
// than as a redirect, because a half-started hand-off would leave the browser
// at a provider the flow has no pending record for.
type FlowSSOAuthorizer interface {
	// Authorize records the pending callback and returns where to send the
	// browser. `slug` is the connection the pressed button named, which the
	// engine has already checked against the step's own `sso_providers`.
	Authorize(ctx context.Context, in FlowSSOAuthorizeInput) (FlowSSOAuthorizeOutput, error)
}

// FlowSSOAuthorizeInput is what the engine knows at the moment the button is
// pressed. The identity layer reads the connection itself: the engine holds
// only the slug, and the connection's endpoints are not the engine's business.
type FlowSSOAuthorizeInput struct {
	ProjectID string
	// AttemptID ties the pending callback to the sign-in attempt in progress,
	// so a callback cannot resume a different one.
	AttemptID string
	// FlowID is what the callback appends to the return target as `?flow=`,
	// which is how the page that comes back finds the flow it left.
	FlowID string
	Slug   string
	// StepName is the step that offered the button, recorded so a callback
	// landing on a flow that has since moved can be rejected rather than
	// resumed into the wrong place.
	StepName string
}

// FlowSSOAuthorizeOutput is the authorize URL, plus the value the browser has
// to hold for the callback to prove it is the same browser.
type FlowSSOAuthorizeOutput struct {
	// RedirectURL is the provider's authorize endpoint with the engine's
	// parameters applied. A full-page navigation, not a fetch.
	RedirectURL string
	// BindingNonce is handed to the API, which sets it as a `__Host-` cookie.
	// Only the hash is stored (ADR 029, verify-only values), so this is the
	// one moment the plaintext exists outside the browser.
	BindingNonce string
}
