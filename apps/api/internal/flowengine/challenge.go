package flowengine

import (
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// challengeMethod declares one two-phase ceremony: the engine issues its
// challenge, holds it pending on the state, and verifies the proof the
// client returns for it.
type challengeMethod struct {
	// check is the auth-attempt check the ceremony runs as.
	check domain.AuthCheckType
	// label names the ceremony in wrapped service errors.
	label string
	// invalidError is the step error a rejected or stale proof renders.
	invalidError string
	// bindsUserAtIssue keeps the user the issued challenge names as the
	// flow's user; verifying resolves no other.
	bindsUserAtIssue bool
	// createsUser lets verifying create the attempt's user: the proof
	// carries the sign-up, and a conflicting user routes as
	// user_already_exists.
	createsUser bool
	// irreversible drops back navigation once the proof verifies.
	irreversible bool
	// params builds what the challenge is issued with from the fields the
	// ceremony reads.
	params func(pc *processCtx, fields domain.FlowResolvedFields) (domain.FlowChallengeParams, error)
}

// challengeMethods holds one declaration per [domain.FlowPendingChallenge]
// method.
var challengeMethods = map[string]challengeMethod{
	FlowChallengeMethodPasskey: {
		check:        domain.AuthCheckTypePasskey,
		label:        "passkey",
		invalidError: FlowStepErrorPasskeyInvalid,
		params:       passkeyChallengeParams,
	},
	FlowChallengeMethodPasskeyRegister: {
		check:            domain.AuthCheckTypePasskeyRegistration,
		label:            "passkey registration",
		invalidError:     FlowStepErrorPasskeyRegistrationInvalid,
		bindsUserAtIssue: true,
		createsUser:      true,
		irreversible:     true,
		params:           passkeyRegistrationChallengeParams,
	},
}

// challengeMethodFor returns the declaration of method. A proof naming no
// declared method is verified as a passkey assertion.
func challengeMethodFor(method string) challengeMethod {
	if declared, ok := challengeMethods[method]; ok {
		return declared
	}
	return challengeMethods[FlowChallengeMethodPasskey]
}

// issueChallenge mints a challenge of method and renders the step carrying
// it. fields are what the ceremony reads, resolved the step's.
func (r *FlowStateMachineRuntime) issueChallenge(pc *processCtx, method string, resolved, fields domain.FlowResolvedFields) (FlowStepResult, error) {
	state := pc.state
	declared := challengeMethods[method]
	params, err := declared.params(pc, fields)
	if err != nil {
		return FlowStepResult{}, err
	}
	out, err := r.authAttempts.IssueChallenge(pc.ctx, domain.FlowIssueChallengeInput{
		ProjectID: state.ProjectID,
		AttemptID: state.AuthAttemptID,
		Params:    params,
	})
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: issue %s: %w", declared.label, err)
	}
	if declared.bindsUserAtIssue {
		// Keep the (possibly minted) user handle so a re-issued challenge
		// stays stable and the verify leg knows which user it targets.
		state.CollectedData.UserID = out.UserID
	}
	state.PendingChallenge = &domain.FlowPendingChallenge{
		ID:       out.ChallengeID,
		Method:   method,
		Options:  out.Options,
		IssuedAt: r.now(),
	}
	return r.renderPendingChallenge(pc, resolved)
}

// verifyChallenge verifies the proof that arrived with the submission, by the
// pending ceremony's method, and routes the submitted action. The pending
// ceremony may be missing if the cookie was lost mid-ceremony; the DB
// rejects unknown challenge ids. fields are what the ceremony reads.
func (r *FlowStateMachineRuntime) verifyChallenge(pc *processCtx, resolved, fields domain.FlowResolvedFields) (FlowStepResult, error) {
	ctx, state, in := pc.ctx, pc.state, pc.in
	// The server-issued id is authoritative; never trust a client-supplied
	// one to rebind the proof to a different challenge.
	challengeID := in.ChallengeResponse.ChallengeID
	method := in.ChallengeResponse.Method
	if state.PendingChallenge != nil {
		challengeID = state.PendingChallenge.ID
		method = state.PendingChallenge.Method
	}
	declared := challengeMethodFor(method)

	verifyInput := domain.FlowVerifyChallengeInput{
		ProjectID:   state.ProjectID,
		AttemptID:   state.AuthAttemptID,
		Check:       declared.check,
		ChallengeID: challengeID,
		Proof:       in.ChallengeResponse.Proof,
	}
	if declared.createsUser {
		// The attempt service decides from the stored challenge whether the
		// ceremony is provisional; a provisional one spends the sign-up
		// proof and creates the user in the verify transaction.
		verifyInput.SignUp = &domain.FlowChallengeSignUp{
			UserSchemaURL:  state.UserSchemaURL,
			UserAttributes: state.CollectedData.UserData,
			State:          state,
			GateProofs:     in.GateProofs,
		}
	}
	userID, err := r.authAttempts.VerifyChallenge(ctx, verifyInput)
	if errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)) || errors.Is(err, domain.ErrAuthAttemptStaleChallenge()) {
		// The ceremony window is tighter than the attempt TTL, and a deploy
		// can strand an in-flight ceremony too. Both a rejected and a stale
		// proof render on the step with the pending ceremony cleared, so a
		// retry mints a fresh challenge.
		state.ClearPendingChallenge()
		return r.renderStepError(pc, resolved, domain.FlowStepFailed(declared.invalidError, err))
	}
	if declared.createsUser && errors.Is(err, domain.ErrUserAlreadyExists()) {
		return r.routeCreatedUserConflict(pc, resolved, fields)
	}
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: submit %s: %w", declared.label, err)
	}
	if declared.bindsUserAtIssue {
		userID = state.CollectedData.UserID
	}
	recordResolvedUser(state, userID)
	state.ClearPendingChallenge()
	return r.routeOutcome(pc, resolved, in.Action, declared.irreversible)
}

// routeCreatedUserConflict routes a ceremony whose new user lost a unique
// attribute to an existing one, like the identifier dispatch does. That path
// pins the existing user on the attempt before routing — and the downstream
// password step requires a persisted user factor — so the conflicting owner
// is re-resolved here to land in the same state. Trying every collected
// uniquely-keyed field finds the owner even when the race was lost on an
// undesignated unique attribute (e.g. a fresh email but a taken phone).
func (r *FlowStateMachineRuntime) routeCreatedUserConflict(pc *processCtx, resolved, fields domain.FlowResolvedFields) (FlowStepResult, error) {
	ctx, state := pc.ctx, pc.state
	clearUserBoundState(state)
	candidates := uniqueFieldValues(state.CollectedData.UserData, fields)
	if visited, verr := r.resolveVisitedFields(pc); verr == nil {
		candidates = uniqueFieldValues(state.CollectedData.UserData, fields, visited)
	}
	for _, candidate := range candidates {
		// Only a sign-up's create loses this race, so a free candidate is
		// the sign-up's own value, not a failed sign-in: Register keeps it
		// from writing one.
		userID, rerr := r.authAttempts.SubmitIdentifier(ctx, domain.FlowSubmitIdentifierInput{
			ProjectID:     state.ProjectID,
			AttemptID:     state.AuthAttemptID,
			AttributeName: candidate[0],
			Value:         candidate[1],
			UserSchemaURL: state.UserSchemaURL,
			Register:      true,
		})
		if rerr == nil {
			recordResolvedUser(state, userID)
			break
		}
		if !errors.Is(rerr, domain.ErrAuthAttemptProofRejected(nil)) {
			return FlowStepResult{}, fmt.Errorf("flow state machine: resolve conflicting user: %w", rerr)
		}
		// Rejected means this field's value is not the taken one (or the
		// owner vanished again); try the next candidate. All-rejected
		// routes anyway and the next step re-collects.
	}
	return r.routeOutcome(pc, resolved, domain.FlowImplicitOutcomeUserAlreadyExists, false)
}

// renderPendingChallenge renders the step carrying the pending ceremony: one
// just issued, or one a submission of the same kind resumes without a proof.
func (r *FlowStateMachineRuntime) renderPendingChallenge(pc *processCtx, resolved domain.FlowResolvedFields) (FlowStepResult, error) {
	rendered, err := r.buildStep(pc.ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	attachPendingChallenge(rendered, pc.state.PendingChallenge)
	pc.state.IssuedAt = r.now()
	return FlowStepResult{State: pc.state, Step: rendered}, nil
}

// attachPendingChallenge surfaces a pending ceremony on a rendered step so the
// client can run it (and re-run it on a plain GET re-render).
func attachPendingChallenge(step *FlowStep, pc *domain.FlowPendingChallenge) {
	if step == nil || pc == nil {
		return
	}
	step.Challenge = &FlowStepChallenge{
		Method:      pc.Method,
		ChallengeID: pc.ID,
		Options:     pc.Options,
	}
}
