package flowengine

import (
	"context"

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
