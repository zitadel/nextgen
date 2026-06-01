package domain

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowOnSuccessHandler is the contract every on_success mutation
// satisfies. The state machine calls Handle after a step's fields
// validate and before its transition fires.
//
// Each [FlowOnSuccess] value maps to one handler. Implementations live
// in their own file (e.g. flow_on_success_create_user.go).
type FlowOnSuccessHandler interface {
	Handle(ctx context.Context, client database.QueryExecutor, in FlowOnSuccessInput) (FlowOnSuccessResult, error)
	// EstablishedKinds reports the credential kinds this mutation
	// establishes when it runs. The dispatch loop unions the manifests
	// of every on_success handler reachable upstream from the current
	// step to decide whether a collected credential should be verified
	// (kind absent — verify) or skipped (kind present — the mutation
	// owns it).
	EstablishedKinds() []FlowFieldChallenge
}

// onSuccessManifests is the single source of truth for each mutation's
// established credential kinds. Handlers return a copy via
// EstablishedKinds; the definition validator looks up the same table to
// cross-check that the kinds the mutation will establish are collected
// upstream. Add a row when a new on_success is wired.
var onSuccessManifests = map[FlowOnSuccess][]FlowFieldChallenge{
	FlowOnSuccessCreateUser: {FlowFieldChallengeIdentifier, FlowFieldChallengePassword},
}

// ManifestForOnSuccess returns the credential kinds the named mutation
// establishes, or nil if the value is unknown.
func ManifestForOnSuccess(o FlowOnSuccess) []FlowFieldChallenge {
	src := onSuccessManifests[o]
	if src == nil {
		return nil
	}
	out := make([]FlowFieldChallenge, len(src))
	copy(out, src)
	return out
}

// FlowOnSuccessInput is the per-call context the state machine threads
// into a handler.
type FlowOnSuccessInput struct {
	ProjectID     string
	UserSchemaURL string
	Fields        map[string]any
	Resolved      FlowResolvedFields
	State         *FlowState
	ResolvedFlow  *FlowDefinition
}

// FlowOnSuccessResult is what a handler returns. Outcome overrides the
// transition key (empty = use the submitted action). StepError keeps
// the user on the current step. UserID, when set, is recorded on the
// flow state.
type FlowOnSuccessResult struct {
	Outcome   string
	StepError *string
	UserID    string
}

// FlowPasswordHasher hashes plaintext passwords into the PHC string
// stored on [UserPassword.EncodedHash].
type FlowPasswordHasher interface {
	Hash(plain string) (encoded string, err error)
}
