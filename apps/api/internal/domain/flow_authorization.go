package domain

import (
	"context"
	"encoding/json"
	"fmt"
)

// The steps the engine inserts into a flow that answers an authorization
// request (ADR 081 §11). A flow definition cannot use their names, so no
// definition can drop or replace them.
const (
	FlowStepNameConsent       = "consent"
	FlowStepNameAccountChoice = "account_choice"
)

// The consent step's actions. The engine offers them on that step alone.
const (
	FlowActionAccept = "accept"
	FlowActionDeny   = "deny"
)

// reservedStepNames are the step names a flow definition cannot use.
var reservedStepNames = map[string]struct{}{
	FlowStepNameConsent:       {},
	FlowStepNameAccountChoice: {},
}

// FlowAuthRequest is the authorization request a flow answers (ADR 081 §8):
// what the page shows of it, and the authorization server's own record, which
// the engine hands back when the flow ends. It is sealed with the flow state.
type FlowAuthRequest struct {
	// ID identifies the request.
	ID string
	// BindingCookie is the cookie that ties the request to the browser that
	// made it, one per request, so a second request in the same browser
	// leaves the first one alone (ADR 081 §8). The flow clears it when it
	// ends.
	BindingCookie string
	Client        FlowClient
	API           FlowAPI
	// Scope is what the client asks for, in its order.
	Scope []string
	// ForceLogin is prompt=login: the user signs in again, live session or
	// not.
	ForceLogin bool `json:",omitempty"`
	// NoInteraction is prompt=none: the flow answers at once and never shows
	// a step.
	NoInteraction bool `json:",omitempty"`
	// Failed is a request that failed its checks after its redirect URI was:
	// the flow answers it at once with that error, and signs no one in.
	Failed bool `json:",omitempty"`
	// Record is the authorization server's request, opaque to the engine.
	Record json.RawMessage
}

// FlowClient is the client a flow signs the user in to.
type FlowClient struct {
	ID      string
	Name    string
	LogoURI string `json:",omitempty"`
	// RedirectHost is where the browser returns, host and port.
	RedirectHost string
	// FirstParty clients are asked for consent only when the request asks.
	FirstParty bool `json:",omitempty"`
}

// FlowAPI is the API a client asks for a token to.
type FlowAPI struct {
	Identifier string
	Name       string
}

// FlowStepConsent is what the consent step asks the user about: the API and
// the scopes the request's client wants.
type FlowStepConsent struct {
	API    FlowAPI
	Scopes []FlowConsentScope
}

// FlowConsentScope is one line of the consent step.
type FlowConsentScope struct {
	Name    string
	TextKey string
}

// FlowAuthAnswer is how a flow answers its authorization request.
type FlowAuthAnswer uint8

const (
	// FlowAuthAllow issues the client a code for the user.
	FlowAuthAllow FlowAuthAnswer = iota
	// FlowAuthDeny returns access_denied: the user refused the consent.
	FlowAuthDeny
	// FlowAuthLoginRequired returns login_required: prompt=none, and no one
	// is signed in.
	FlowAuthLoginRequired
	// FlowAuthConsentRequired returns consent_required: prompt=none, and the
	// user has not consented to what the client asks.
	FlowAuthConsentRequired
	// FlowAuthFailed returns the error the request failed its checks with.
	FlowAuthFailed
)

// FlowAuthorizer is the authorization server's side of a flow that answers an
// authorization request.
type FlowAuthorizer interface {
	// NeedsConsent reports whether the user must be asked before the client
	// gets what the request asks for (ADR 082 §8).
	NeedsConsent(ctx context.Context, projectID string, req *FlowAuthRequest, userID string) (bool, error)
	// Answer ends the request for the user and returns where the browser
	// goes: the client's redirect URI with a code, or with the error. An
	// answer the client may not get without the user having seen it fails
	// with [ErrFlowAuthRequestInvalid].
	Answer(ctx context.Context, projectID string, req *FlowAuthRequest, userID string, answer FlowAuthAnswer) (string, error)
}

// ErrFlowAuthRequestInvalid refuses an authorization request a flow cannot
// answer: its handle is unknown or expired, the browser lacks the cookie that
// binds it, or the answer may not go back to the client unasked. The user
// returns to the app and starts again.
func ErrFlowAuthRequestInvalid() Error {
	return newError(PrefixFlow.ErrorCodePrefix("auth_request_invalid"), "the sign-in request is not valid here; start again from the app", nil, nil)
}

// consentStep renders the consent step for the state's request.
func consentStep(state *FlowState) *FlowStep {
	req := state.AuthRequest
	scopes := make([]FlowConsentScope, 0, len(req.Scope))
	for _, scope := range req.Scope {
		scopes = append(scopes, FlowConsentScope{Name: scope, TextKey: "scope." + scope})
	}
	return &FlowStep{
		Name:    FlowStepNameConsent,
		Texts:   FlowStepTexts{TitleKey: FlowStepNameConsent + ".title", DescriptionKey: FlowStepNameConsent + ".description"},
		Purpose: state.CurrentPurpose,
		Actions: []FlowAction{
			{Name: FlowActionAccept, Kind: FlowActionKindSubmit, TextKey: FlowStepNameConsent + ".action." + FlowActionAccept, Primary: true},
			{Name: FlowActionDeny, Kind: FlowActionKindNavigate, TextKey: FlowStepNameConsent + ".action." + FlowActionDeny},
		},
		Consent: &FlowStepConsent{API: req.API, Scopes: scopes},
	}
}

// terminalStep is the definition step a flow that answers an authorization
// request rests on once its user is known: the one its definition ends in.
// The consent step is drawn over it, and the flow terminates there.
func terminalStep(def *FlowDefinition) (*FlowDefinitionStep, error) {
	for i := range def.Steps {
		if def.Steps[i].Complete != nil {
			return &def.Steps[i], nil
		}
	}
	return nil, fmt.Errorf("%w: definition %q has no terminal step", ErrFlowIntegrity(), def.ID)
}

// concludeAuthorization ends a flow that answers an authorization request
// once its user is known and it rests on its terminal step: under the consent
// step when the user must consent (ADR 081 §11), else with the client's code.
func (r *FlowStateMachineRuntime) concludeAuthorization(pc *processCtx) (FlowStepResult, error) {
	state := pc.state
	if state.CollectedData.UserID == "" {
		// The definition ended without signing anyone in: no one to answer for.
		return r.answerAuthorization(pc, FlowAuthLoginRequired)
	}
	needs, err := r.authorizer.NeedsConsent(pc.ctx, state.ProjectID, state.AuthRequest, state.CollectedData.UserID)
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: consent: %w", err)
	}
	if !needs {
		return r.answerAuthorization(pc, FlowAuthAllow)
	}
	if state.AuthRequest.NoInteraction {
		return r.answerAuthorization(pc, FlowAuthConsentRequired)
	}
	// The user is signed in from here on: no step to go back to.
	state.ClearBackStack()
	state.AwaitingConsent = true
	state.IssuedAt = r.now()
	return FlowStepResult{State: state, Step: consentStep(state)}, nil
}

// processConsent takes the user's answer on the consent step.
func (r *FlowStateMachineRuntime) processConsent(pc *processCtx) (FlowStepResult, error) {
	switch pc.in.Action {
	case FlowActionAccept:
		return r.answerAuthorization(pc, FlowAuthAllow)
	case FlowActionDeny:
		return r.answerAuthorization(pc, FlowAuthDeny)
	}
	return FlowStepResult{}, fmt.Errorf("%w: %q on step %q", ErrFlowInvalidAction(), pc.in.Action, FlowStepNameConsent)
}

// answerAuthorization terminates the flow with its request's answer: a
// redirect to the client, with a code or the error, whatever the definition's
// terminal step says (ADR 081 §9). The handoff, when the flow signed the user
// in, lets the page keep the session before it navigates.
func (r *FlowStateMachineRuntime) answerAuthorization(pc *processCtx, answer FlowAuthAnswer) (FlowStepResult, error) {
	state := pc.state
	target, err := r.authorizer.Answer(pc.ctx, state.ProjectID, state.AuthRequest, state.CollectedData.UserID, answer)
	if err != nil {
		return FlowStepResult{}, err
	}
	state.AwaitingConsent = false
	state.RedirectURI = &target
	return r.terminateAs(pc, FlowStepCompleteRedirect)
}
