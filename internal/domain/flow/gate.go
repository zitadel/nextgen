package flow

import "context"

// GateType is the family of pre-submit challenge a gate enforces. New
// types are added as new authentication patterns warrant them.
type GateType string

const (
	GateCaptcha GateType = "captcha"
)

// Gate issues a per-render challenge config and verifies the client's
// proof on submit. Implementations are pluggable per (type, provider).
//
// Passkey authentication is modeled as a credential auth_attempt with
// x-credential: passkey, not as a gate. Gates are reserved for
// captcha-style "satisfy before submit" challenges.
type Gate interface {
	Type() GateType
	Provider() string

	// Issue produces the per-render config emitted under
	// step.gates[name].config.
	Issue(ctx context.Context, in IssueInput) (IssueOutput, error)

	// Verify checks the proof submitted by the client.
	Verify(ctx context.Context, in VerifyInput) error
}

// GateRegistry resolves a (type, provider) pair to a concrete [Gate]
// implementation. The MVP registers entries statically at bootstrap;
// per-project dynamic registration is deferred.
type GateRegistry interface {
	Get(typ GateType, provider string) (Gate, error)
}

// IssueInput is the input to [Gate.Issue].
type IssueInput struct {
	FlowID    string
	SessionID string
	StepName  string
}

// IssueOutput is the output of [Gate.Issue].
type IssueOutput struct {
	Required bool
	Config   map[string]any
}

// VerifyInput is the input to [Gate.Verify].
type VerifyInput struct {
	FlowID    string
	SessionID string
	StepName  string
	Proof     string
}
