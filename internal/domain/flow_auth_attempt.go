package domain

import (
	"context"
	"time"
)

// FlowAuthAttemptService is the [FlowStateMachine]'s narrow view of the
// auth-attempt domain. Submit* calls collapse the underlying
// issue-then-verify cycle so the state machine never sees challenge
// IDs. Identifier no-match and password failure surface as
// [ErrAuthAttemptProofRejected] (use [errors.Is]).
type FlowAuthAttemptService interface {
	Start(ctx context.Context, in FlowCreateAttemptInput) (attemptID string, err error)
	SubmitIdentifier(ctx context.Context, in FlowSubmitIdentifierInput) (userID string, err error)
	SubmitPassword(ctx context.Context, in FlowSubmitPasswordInput) error
	// Handoff mints the single-use token the client exchanges for a
	// session. Called by the state machine on the terminal step.
	Handoff(ctx context.Context, in FlowHandoffInput) (FlowHandoffOutput, error)
}

// FlowCreateAttemptInput is the bootstrap input to
// [FlowAuthAttemptService.Start]. SessionID is set only for step-up
// auth; RequiredChecks overrides the project default when pinned.
type FlowCreateAttemptInput struct {
	ProjectID      string
	SessionID      *string
	RequiredChecks []AuthCheckType
}

// FlowSubmitIdentifierInput names the submitted identifier field
// (AttributeName, e.g. "email") and the user-entered value the
// auth-attempt service resolves to a user.
type FlowSubmitIdentifierInput struct {
	ProjectID     string
	AttemptID     string
	AttributeName string
	Value         string
}

type FlowSubmitPasswordInput struct {
	ProjectID string
	AttemptID string
	Plain     string
}

type FlowHandoffInput struct {
	ProjectID string
	AttemptID string
}

type FlowHandoffOutput struct {
	Token     string
	ExpiresAt time.Time
}
