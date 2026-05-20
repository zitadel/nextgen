package domain

import "context"

// FlowAuthAttemptService is the [FlowStateMachine]'s narrow view of the
// auth-attempt domain. Each Submit* call collapses the underlying
// issue-then-verify cycle so the state machine never sees challenge
// IDs. Identifier no-match and password failure both surface as
// [ErrAuthAttemptProofRejected] (use [errors.Is]).
type FlowAuthAttemptService interface {
	Start(ctx context.Context, in FlowCreateAttemptInput) (attemptID string, err error)
	SubmitIdentifier(ctx context.Context, in FlowSubmitIdentifierInput) (userID string, err error)
	SubmitPassword(ctx context.Context, in FlowSubmitPasswordInput) error
}

// FlowCreateAttemptInput is the bootstrap input to
// [FlowAuthAttemptService.Start]. SessionID is set only for step-up
// auth; RequiredChecks overrides the project default when pinned.
type FlowCreateAttemptInput struct {
	ProjectID      string
	SessionID      *string
	RequiredChecks []AuthCheckType
}

type FlowSubmitIdentifierInput struct {
	ProjectID string
	AttemptID string
	Value     string
}

type FlowSubmitPasswordInput struct {
	ProjectID string
	AttemptID string
	Plain     string
}

// FlowAuthAttemptRuntime is the production [FlowAuthAttemptService].
// Methods are panic-stubbed until the auth-attempt PR line fleshes out
// the underlying issue+verify primitives.
type FlowAuthAttemptRuntime struct{}

func NewFlowAuthAttemptRuntime() *FlowAuthAttemptRuntime {
	return &FlowAuthAttemptRuntime{}
}

var _ FlowAuthAttemptService = (*FlowAuthAttemptRuntime)(nil)

func (r *FlowAuthAttemptRuntime) Start(ctx context.Context, in FlowCreateAttemptInput) (string, error) {
	panic("implement me")
}

func (r *FlowAuthAttemptRuntime) SubmitIdentifier(ctx context.Context, in FlowSubmitIdentifierInput) (string, error) {
	panic("implement me")
}

func (r *FlowAuthAttemptRuntime) SubmitPassword(ctx context.Context, in FlowSubmitPasswordInput) error {
	panic("implement me")
}
