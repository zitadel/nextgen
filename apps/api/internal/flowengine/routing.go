package flowengine

import (
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// routeOutcome sends the user to the next step: looks up the
// transition for outcome, flips the purpose, advances state, then
// renders, or completes the flow on a terminal step. When outcome differs
// from the user-submitted action it came from a handler diversion
// (e.g. user_not_found); a missing transition in that case degrades
// to the outcome's step error instead of ErrFlowInvalidAction. If
// irreversible, BackStack is dropped after advance.
func (r *Runtime) routeOutcome(pc *processCtx, resolved domain.FlowResolvedFields, outcome string, irreversible bool) (StepResult, error) {
	transition, ok := pc.currentStep.Transitions[outcome]
	if !ok {
		if outcome != pc.in.Action {
			// The found user is already on the attempt. Keeping it would block
			// a corrected identifier and let a passkey register on that user.
			// The password stays: on sign-up it is the one chosen for the new
			// account, and a later step may not collect it again.
			if outcome == domain.FlowImplicitOutcomeUserAlreadyExists {
				if err := r.dropResolvedUser(pc, "unrouted collision"); err != nil {
					return StepResult{}, err
				}
			}
			return r.renderStepError(pc, resolved, domain.FlowStepFailed(UnwiredOutcomeError(outcome), nil))
		}
		return StepResult{}, fmt.Errorf("%w: %q on step %q", domain.ErrFlowInvalidAction(), pc.in.Action, pc.currentStep.Name)
	}
	if transition.Action != nil {
		return StepResult{}, fmt.Errorf("%w: cross-flow transitions", domain.ErrFlowUnsupported())
	}

	target := pc.def.TransitionTarget(transition)
	nextStep, ok := pc.def.FindStep(target)
	if !ok {
		return StepResult{}, fmt.Errorf("%w: transition target %q missing from definition", domain.ErrFlowIntegrity(), target)
	}

	next := route{outcome: outcome, transition: transition, target: nextStep, irreversible: irreversible}
	if nextStep.Complete != nil {
		return r.completeFlow(pc, resolved, next)
	}
	prevPurpose, err := r.follow(pc, next)
	if err != nil {
		return StepResult{}, err
	}

	step, err := r.renderStep(pc.ctx, pc.def, pc.state)
	if err != nil {
		return StepResult{}, err
	}
	// The user asked to sign in or to sign up; an outcome that changed which
	// one says why, or a typo silently becomes a new account. The notice is
	// not kept in the state, so a later render of the step goes without it.
	if notice, ok := purposeChangeNotices[outcome]; ok && pc.state.CurrentPurpose != prevPurpose {
		step.Notice = &notice
	}
	return StepResult{State: pc.state, Step: step}, nil
}

// route is where an outcome leads from the current step: the transition
// [Runtime.routeOutcome] looked up and the step it targets.
type route struct {
	outcome      string
	transition   domain.FlowStepTransition
	target       *domain.FlowDefinitionStep
	irreversible bool
}

// follow moves the state along next: flips the purpose, advances to the
// target step and drops the back stack after an irreversible action. It
// returns the purpose the flow had before, which back restores.
func (r *Runtime) follow(pc *processCtx, next route) (domain.FlowDefinitionPurpose, error) {
	transition, nextStep := next.transition, next.target
	// Snapshot purpose before the flip so back can restore it.
	prevPurpose := pc.state.CurrentPurpose
	applyOutcomeFlip(pc.state, next.outcome)
	// A declared transition purpose wins over the implicit outcome flip.
	// Only CurrentPurpose moves; the pinned Purpose stays for telemetry/ACR.
	// Unlike the implicit flips (which continue an in-flight resolution,
	// e.g. register + user_already_exists verifying the found user), a
	// declared re-purpose starts the target purpose fresh: the resolved
	// user, collected credential material, and ceremony state must not
	// leak across. A login-resolved user surviving into register would
	// let passkey registration attach a credential to an existing account
	// without proving a factor.
	repurposeUndo := false
	if transition.Purpose != nil {
		if err := r.dropResolvedUser(pc, "re-purpose"); err != nil {
			return prevPurpose, err
		}
		pc.state.CollectedData.AuthMethods = nil
		pc.state.CurrentPurpose = *transition.Purpose

		// Purpose entries link to each other, forming a zero-input loop.
		// An exact undo of the previous navigation pops the back stack
		// instead of pushing, so toggling Sign up / Sign in cannot grow
		// History/BackStack past one entry (unbounded growth overflows
		// the 4 KiB encrypted-cookie budget). Anything else falls through
		// to the normal advance.
		if top, ok := pc.state.PeekBackStack(); ok &&
			top.StepName == nextStep.Name && top.Purpose == *transition.Purpose &&
			len(pc.state.History) > 0 && pc.state.History[len(pc.state.History)-1] == top.StepName {
			pc.state.PopBackStack()
			pc.state.History = pc.state.History[:len(pc.state.History)-1]
			pc.state.CurrentStep = nextStep.Name
			pc.state.IssuedAt = r.now()
			repurposeUndo = true
		}
	}

	if !repurposeUndo {
		r.advance(pc.state, pc.currentStep, prevPurpose, nextStep.Name)
	}

	// after irreversible actions, clear the back stack so the user can't navigate back in the flow.
	if next.irreversible {
		pc.state.ClearBackStack()
	}
	return prevPurpose, nil
}

// dropResolvedUser abandons the identity this flow had settled on: the
// resolved user and any in-flight ceremony. When a user was resolved it
// rotates the auth attempt in lockstep. The collected password is left to
// the caller, since only some callers drop the identity it belongs to.
//
// The persisted attempt carries the resolved user as a factor, and
// PrepareUserChallenge refuses a second user challenge on a session-linked
// attempt — which every flow is, since the flow service links the attempt to
// the session it runs against. Clearing the flow state without rotating
// leaves the attempt one step ahead of the flow, and the next identifier
// submission dies on "The user was already authenticated". The abandoned
// attempt ages out like any abandoned flow. No resolved user → nothing on the
// attempt to escape → no rotation (idle navigation must not mint attempt
// rows). reason names the caller for the wrapped error.
func (r *Runtime) dropResolvedUser(pc *processCtx, reason string) error {
	hadResolvedUser := pc.state.CollectedData.UserID != ""
	clearUserBoundState(pc.state)
	if !hadResolvedUser {
		return nil
	}
	attemptInput := CreateAttemptInput{ProjectID: pc.state.ProjectID, FlowID: pc.state.ID}
	if pc.state.SessionID != "" {
		sid := pc.state.SessionID
		attemptInput.SessionID = &sid
	}
	attemptID, err := r.authAttempts.Start(pc.ctx, attemptInput)
	if err != nil {
		return fmt.Errorf("flow state machine: rotate auth attempt on %s: %w", reason, err)
	}
	pc.state.AuthAttemptID = attemptID
	return nil
}

// dispatchResult summarizes the challenge dispatch loop. Outcome
// diverts routing (e.g. user_not_found); StepError holds the user on
// the current step (e.g. password rejected). At most one is set.
type dispatchResult struct {
	Outcome   string
	StepError *domain.FlowStepFailure
}

// challengeDispatchOrder pins the order in which field-shaped
// challenges are submitted. Identifier precedes Password because the
// auth-attempt domain requires the user to be identified first.
var challengeDispatchOrder = []domain.FlowFieldChallenge{
	domain.FlowFieldChallengeIdentifier,
	domain.FlowFieldChallengePassword,
}

// identifierFieldsOnly keeps just the identifier-challenge entries of a
// submission. A passkey login leg consumes exactly one value — the identifier
// that scopes allowCredentials — but browsers post the whole form, so the
// step's other fields ride along with the action. Choosing "sign in with a
// passkey" is not a submission of those fields: validating them fails the leg
// on an empty required password, and dispatching them verifies that password
// as a credential — both before the WebAuthn prompt ever appears. Dropping
// them here keeps validation, dispatch, and collection agreeing on what the
// leg was given.
//
// What survives is whatever the *current step* declares as an identifier
// field — so an identifier step keeps its value, empty or not, and the rules
// deciding whether a blank identifier is usable keep applying to it, while a
// step that declares no identifier (the password step) submits nothing at
// all. That is the discoverable ceremony: the assertion carries the user
// handle instead.
func identifierFieldsOnly(resolved domain.FlowResolvedFields, values map[string]any) map[string]any {
	kept := make(map[string]any)
	for _, field := range resolved.Fields {
		if field.Challenge != domain.FlowFieldChallengeIdentifier {
			continue
		}
		if value, submitted := values[field.Name]; submitted {
			kept[field.Name] = value
		}
	}
	return kept
}

// applyOutcomeFlip flips CurrentPurpose on resolution outcomes:
// login + user_not_found → register; login + sso_user_not_found → register;
// register + user_already_exists → login, typed or SSO. Recovery never flips.
func applyOutcomeFlip(state *State, outcome string) {
	switch {
	case state.CurrentPurpose == domain.FlowDefinitionPurposeLogin &&
		(outcome == domain.FlowImplicitOutcomeUserNotFound || outcome == domain.FlowImplicitOutcomeSSOUserNotFound):
		state.CurrentPurpose = domain.FlowDefinitionPurposeRegister
	case state.CurrentPurpose == domain.FlowDefinitionPurposeRegister && outcome == domain.FlowImplicitOutcomeUserAlreadyExists:
		state.CurrentPurpose = domain.FlowDefinitionPurposeLogin
	}
}

// dispatchChallenges submits field-shaped challenges in
// [challengeDispatchOrder]. CurrentPurpose decides verify-vs-skip. What
// reaches it is what the action submitted, so a leg that consumes a subset
// (see [identifierFieldsOnly]) dispatches a subset.
func (r *Runtime) dispatchChallenges(pc *processCtx, resolved domain.FlowResolvedFields) (dispatchResult, error) {
	ctx, state, fields := pc.ctx, pc.state, pc.in.Fields
	for _, challenge := range challengeDispatchOrder {
		name, value, ok := fieldValueByChallenge(resolved, fields, challenge)
		if !ok {
			continue
		}
		switch challenge {
		case domain.FlowFieldChallengeIdentifier:
			userID, err := r.authAttempts.SubmitIdentifier(ctx, SubmitIdentifierInput{
				ProjectID:     state.ProjectID,
				AttemptID:     state.AuthAttemptID,
				AttributeName: name,
				Value:         value,
				UserSchemaURL: state.UserSchemaURL,
				Register:      state.CurrentPurpose == domain.FlowDefinitionPurposeRegister,
			})
			if errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)) {
				if state.CurrentPurpose == domain.FlowDefinitionPurposeRegister {
					continue
				}
				clearUserBoundState(state)
				return dispatchResult{Outcome: domain.FlowImplicitOutcomeUserNotFound}, nil
			}
			if err != nil {
				return dispatchResult{}, fmt.Errorf("flow state machine: submit identifier: %w", err)
			}
			// A successful lookup pins the user on the attempt whichever
			// purpose asked for it, so the flow records it either way.
			// user_already_exists then flips to login and routes to
			// verification, where the flow is verifying exactly this user — so
			// recording is honest, and it keeps CollectedData.UserID a truthful
			// signal of what the attempt carries. Left blank, the two fall out
			// of step: back skips its rotation and completion skips the handoff.
			recordResolvedUser(state, userID)
			if state.CurrentPurpose == domain.FlowDefinitionPurposeRegister {
				return dispatchResult{Outcome: domain.FlowImplicitOutcomeUserAlreadyExists}, nil
			}
		case domain.FlowFieldChallengePassword:
			if state.CurrentPurpose != domain.FlowDefinitionPurposeLogin {
				continue
			}
			// A sign-in password is checked, not stored: [mergeCollected]
			// has already banked it, so it is dropped here rather than
			// carried into whatever the flow resolves next. The only
			// on_success a login step can run is create_user, which would
			// store it on a new account rather than the one it verified.
			delete(state.CollectedData.AuthMethods, domain.AuthMethodPassword)
			if state.CollectedData.UserID == "" {
				return dispatchResult{StepError: domain.FlowStepFailed(StepErrorSignInFirst, nil)}, nil
			}
			err := r.authAttempts.SubmitPassword(ctx, SubmitPasswordInput{
				ProjectID: state.ProjectID,
				AttemptID: state.AuthAttemptID,
				Plain:     value,
			})
			if errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)) {
				return dispatchResult{StepError: domain.FlowStepFailed(StepErrorInvalidCredentials, err)}, nil
			}
			if err != nil {
				return dispatchResult{}, fmt.Errorf("flow state machine: submit password: %w", err)
			}
		}
	}
	return dispatchResult{}, nil
}

// uniqueFieldValues returns every uniquely-keyed field with a collected
// value, in field order and deduplicated by name across the given resolved
// sets. Conflict re-resolution is about uniqueness, not identification
// (ADR 058): the race was lost on some unique attribute, designated or
// not, so the candidate list keys on FlowField.Unique — the designated
// identifier alone would miss an undesignated unique attribute (a taken
// username beside a fresh email). The lookup behind SubmitIdentifier goes
// through the unique claims, so probing any unique attribute
// is well-defined regardless of designation.
func uniqueFieldValues(values map[string]any, resolvedSets ...domain.FlowResolvedFields) [][2]string {
	var out [][2]string
	seen := map[string]bool{}
	for _, resolved := range resolvedSets {
		for _, field := range resolved.Fields {
			if field.Unique == domain.AttributeUniquenessUnspecified || seen[field.Name] {
				continue
			}
			s, ok := collectedString(values, field.Name)
			if !ok {
				continue
			}
			seen[field.Name] = true
			out = append(out, [2]string{field.Name, s})
		}
	}
	return out
}

func fieldValueByChallenge(resolved domain.FlowResolvedFields, fields map[string]any, target domain.FlowFieldChallenge) (name, value string, ok bool) {
	for _, field := range resolved.Fields {
		if field.Challenge != target {
			continue
		}
		raw, present := fields[field.Name]
		if !present {
			continue
		}
		s, _ := raw.(string)
		return field.Name, s, true
	}
	return "", "", false
}
