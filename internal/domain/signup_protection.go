package domain

// SignupGate is a runtime gate, independent of the editable flow template.
const SignupGate = "signup_pow"

// SignupChallengeRecord contains only the encrypted server-side challenge.
// One live challenge per project/flow is retained across renders.
type SignupChallengeRecord struct {
	ProjectID string
	FlowID    string
	ID        string
	ExpiresAt int64
	Payload   string
}

// SignupLimits is a fixed one-minute budget shared by all server replicas.
type SignupLimits struct {
	ProjectID   string
	WindowStart int64
	Issued      int64
	Verified    int64
}

// ErrFlowProofInvalid refuses a missing, invalid, expired or spent signup proof.
// Refresh the flow step to obtain its current challenge before retrying.
func ErrFlowProofInvalid() Error {
	return newError(PrefixFlow.ErrorCodePrefix("proof_invalid"), "signup proof is missing, invalid, expired or already used; refresh the step", nil, nil)
}

// ErrFlowRateLimited refuses work after the project's signup budget is spent.
// Retry after one minute; this limit is shared across server replicas.
func ErrFlowRateLimited() Error {
	return newError(PrefixFlow.ErrorCodePrefix("rate_limited"), "signup request limit reached; retry after one minute", nil, nil)
}
