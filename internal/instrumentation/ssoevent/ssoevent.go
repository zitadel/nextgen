// Package ssoevent writes the one structured log event each phase of an
// external sign-in leaves behind. The CLI's `test sign-in` reads these events
// from the runtime log to follow a browser sign-in to its end and to say
// whether the provider or the journey failed.
//
// An event carries the connection slug, the flow id and the phase, and on
// failure a reason and the side that failed. The flow id is the auth attempt
// id: an attempt belongs to exactly one flow, and it is the one handle the
// callback route can read, since the callback has no flow cookie.
//
// The log is where operators and the CLI look, so an event is redacted by
// construction. Everything it can carry besides the slug and the flow id is
// a value from a closed set declared here, or the name of a claim. A code, a
// token, a secret, a claim value or a query string has no field to travel in,
// and the provider's own error text never reaches an event.
//
// A sign-in is complete at the first of these: a [PhaseResolved] success whose
// result is [ResultLinked] or [ResultExistingUser], or a [PhaseUserCreated]
// success. [ResultCollect] is not an end: the user still fills the collection
// step, which ends in [PhaseUserCreated].
package ssoevent

import (
	"context"
	"regexp"
	"slices"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// Message is the log message every event is written with, so a reader can
// pick the events out of the runtime log.
const Message = "sso attempt"

// Phase is the step of the sign-in an event reports.
type Phase string

const (
	// PhaseCeremonyStarted is the authorize redirect being issued.
	PhaseCeremonyStarted Phase = "ceremony_started"
	// PhaseCallbackReceived is the provider's redirect arriving back.
	PhaseCallbackReceived Phase = "callback_received"
	// PhaseExchangeFinished is the code exchange and identity fetch ending.
	PhaseExchangeFinished Phase = "exchange_finished"
	// PhaseResolved is the identity being matched to a user, or refused.
	PhaseResolved Phase = "resolved"
	// PhaseUserCreated is the user and its identity link being created.
	PhaseUserCreated Phase = "user_created"
)

// Result is what a [PhaseResolved] success settled on.
type Result string

const (
	// ResultLinked is a known identity bound to its user.
	ResultLinked Result = "linked"
	// ResultExistingUser is an unlinked identity bound to the user that owns
	// one of its unique claims.
	ResultExistingUser Result = "existing_user"
	// ResultCreated is an unlinked identity that got a new user.
	ResultCreated Result = "created"
	// ResultCollect is an unlinked identity that needs the collection step.
	ResultCollect Result = "collect"
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
// provider's text out of the log.
type Reason string

const (
	ReasonProviderDenied   Reason = "provider_denied"
	ReasonProviderError    Reason = "provider_error"
	ReasonDiscoveryFailed  Reason = "discovery_failed"
	ReasonExchangeFailed   Reason = "exchange_failed"
	ReasonIDTokenInvalid   Reason = "id_token_invalid"
	ReasonUserinfoFailed   Reason = "userinfo_failed"
	ReasonStateInvalid     Reason = "state_invalid"
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

// Event is one phase of one sign-in attempt.
type Event struct {
	// Slug is the connection's slug. A value that is not a slug is dropped:
	// the callback path is the caller's.
	Slug string
	// FlowID is the auth attempt id.
	FlowID string
	Phase  Phase
	// Result is set on a [PhaseResolved] success.
	Result Result
	// Reason is empty on success.
	Reason Reason
	// ClaimNames are the names of the claims the provider sent, never their
	// values.
	ClaimNames []string
}

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// Emit writes the event: info on success, warn on failure.
func Emit(ctx context.Context, e Event) {
	slug := e.Slug
	if !slugPattern.MatchString(slug) {
		slug = ""
	}
	args := []any{"slug", slug, "flow_id", e.FlowID, "phase", string(e.Phase)}
	if e.Result != "" {
		args = append(args, "result", string(e.Result))
	}
	if e.ClaimNames != nil {
		names := slices.Clone(e.ClaimNames)
		slices.Sort(names)
		args = append(args, "claims", names)
	}
	if e.Reason == "" {
		args = append(args, "status", "ok")
		zlog.Info(ctx, Message, args...)
		return
	}
	args = append(args, "status", "failed", "reason", string(e.Reason), "side", string(e.Reason.Side()))
	zlog.Warn(ctx, Message, args...)
}
