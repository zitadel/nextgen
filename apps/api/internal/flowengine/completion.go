package flowengine

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// CompletionPolicy decides whether a flow may complete. The engine asks it
// on every completion, before the flow leaves its step and before any
// handoff is minted.
type CompletionPolicy interface {
	// CheckCompletion returns nil to let the flow complete, or the step
	// error, an `error.*` catalog key, that holds it on its current step.
	CheckCompletion(ctx context.Context, in CompletionCheckInput) (*domain.FlowStepFailure, error)
}

// CompletionCheckInput names the flow about to complete. State is still on
// the step the flow completes from.
type CompletionCheckInput struct {
	ProjectID string
	AttemptID string
	State     *State
}

// completeFlow is the one point where a flow completes: every route onto a
// terminal step comes through it, and only it mints the handoff. The
// completion policy is asked before the flow follows the route, so a refusal
// holds the flow on its current step.
func (r *Runtime) completeFlow(pc *processCtx, resolved domain.FlowResolvedFields, next route) (StepResult, error) {
	if r.completion != nil {
		refusal, err := r.completion.CheckCompletion(pc.ctx, CompletionCheckInput{
			ProjectID: pc.state.ProjectID,
			AttemptID: pc.state.AuthAttemptID,
			State:     pc.state,
		})
		if err != nil {
			return StepResult{}, fmt.Errorf("flow state machine: check completion: %w", err)
		}
		if refusal != nil {
			// A navigate routes without resolving the step's fields.
			if resolved.Fields == nil && len(pc.currentStep.Fields) > 0 {
				if resolved, err = r.resolveInputs(pc); err != nil {
					return StepResult{}, err
				}
			}
			return r.renderStepError(pc, resolved, refusal)
		}
	}
	if _, err := r.follow(pc, next); err != nil {
		return StepResult{}, err
	}

	// No back past a point of no return.
	pc.state.ClearBackStack()
	rendered, err := r.renderStep(pc.ctx, pc.def, pc.state)
	if err != nil {
		return StepResult{}, err
	}
	kind := *next.target.Complete
	rendered.Complete = &kind
	if kind == domain.FlowStepCompleteRedirect && pc.state.RedirectURI != nil {
		uri := *pc.state.RedirectURI
		rendered.RedirectURL = &uri
	}

	// Skip handoff when no user was resolved (e.g. user_not_found →
	// no-account): render the terminal step without minting a token. Handoff
	// itself fails closed on an identifier-only attempt (IsCompleted
	// requires a verified credential-class factor), but a no-account terminal
	// has nothing to hand off and must return the step cleanly rather than
	// surface ErrAuthAttemptNotCompleted.
	if pc.state.CollectedData.UserID == "" {
		return StepResult{State: pc.state, Step: rendered}, nil
	}

	if pc.state.AuthAttemptID == "" {
		return StepResult{}, fmt.Errorf("%w: terminate without auth attempt id", domain.ErrFlowIntegrity())
	}
	handoff, err := r.authAttempts.Handoff(pc.ctx, HandoffInput{
		ProjectID: pc.state.ProjectID,
		AttemptID: pc.state.AuthAttemptID,
	})
	if err != nil {
		return StepResult{}, fmt.Errorf("flow state machine: handoff: %w", err)
	}
	return StepResult{
		State:                 pc.state,
		Step:                  rendered,
		HandoffToken:          handoff.Token,
		HandoffTokenExpiresAt: handoff.ExpiresAt,
	}, nil
}
