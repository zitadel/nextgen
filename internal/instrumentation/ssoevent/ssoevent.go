// Package ssoevent is the closed vocabulary of an SSO sign-in's failures: the
// phase a failure happened in, the reason, and whose side it was. The audit
// events of a sign-in carry these values and nothing else about a failure, so
// a provider's own error text, a code, a token, a secret or a claim value has
// no place to travel in.
//
// `zitadel test sign-in --live` reads them from the audit event stream to say
// which phase of a sign-in failed and whether the provider or the journey was
// at fault.
package ssoevent

// Phase is where in the sign-in a failure that has no event of its own
// happened. A failure of the callback or of the exchange is told by its event
// type instead.
type Phase string

const (
	// PhaseResolved is the identity being matched to a user, or refused.
	PhaseResolved Phase = "resolved"
	// PhaseUserCreated is the user and its identity link being created.
	PhaseUserCreated Phase = "user_created"
	// PhaseHandedOff is the attempt being handed off to the application.
	PhaseHandedOff Phase = "handed_off"
)

// Side is who failed.
type Side string

const (
	// SideProvider is the identity provider: its error response, an
	// exchange or fetch it failed, or a token it issued that does not verify.
	SideProvider Side = "provider"
	// SideJourney is this server's side: state and cookie problems, the
	// connection, resolution and schema failures, and the creation gate.
	SideJourney Side = "journey"
)

// Reason is the code of a failure. The set is closed, which is what keeps the
// provider's text out of the audit event.
type Reason string

const (
	ReasonProviderDenied   Reason = "provider_denied"
	ReasonProviderError    Reason = "provider_error"
	ReasonDiscoveryFailed  Reason = "discovery_failed"
	ReasonExchangeFailed   Reason = "exchange_failed"
	ReasonIDTokenInvalid   Reason = "id_token_invalid"
	ReasonUserinfoFailed   Reason = "userinfo_failed"
	ReasonStateMismatch    Reason = "state_mismatch"
	ReasonNoCode           Reason = "no_code"
	ReasonConnectionBroken Reason = "connection_invalid"
	ReasonSecretMissing    Reason = "secret_unavailable"
	ReasonSubjectInvalid   Reason = "subject_invalid"
	ReasonCreationDisabled Reason = "creation_disabled"
	ReasonClaimRejected    Reason = "claim_rejected"
	ReasonUnroutable       Reason = "unroutable"
	ReasonUserInvalid      Reason = "user_invalid"
	ReasonOtherSchema      Reason = "other_schema"
	ReasonHandoffFailed    Reason = "handoff_failed"
	ReasonInternal         Reason = "internal"
)

// Side reports who a reason blames.
func (r Reason) Side() Side {
	switch r {
	case ReasonProviderDenied, ReasonProviderError, ReasonDiscoveryFailed,
		ReasonExchangeFailed, ReasonIDTokenInvalid, ReasonUserinfoFailed:
		return SideProvider
	default:
		return SideJourney
	}
}
