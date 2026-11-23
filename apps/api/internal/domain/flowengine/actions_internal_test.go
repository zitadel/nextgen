package flowengine

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

// Every kind a step can declare, or the engine injects, has a handler; unset
// has none, so an action the step does not declare is refused.
func TestActionKindHandlers_OnePerKind(t *testing.T) {
	for _, kind := range domain.FlowActionKindValues() {
		_, ok := actionKindHandlers[kind]
		assert.Equal(t, kind != domain.FlowActionKindUnset, ok, "handler for kind %s", kind)
	}
	assert.Len(t, actionKindHandlers, len(domain.FlowActionKindValues())-1)
}

// Only a passkey registration can create a user, so no other kind lets a
// submission carry the sign-up proof, whatever ceremony is in flight.
func TestActionKindHandlers_OnlyPasskeyRegisterAcceptsSignupProof(t *testing.T) {
	methods := []string{"", FlowChallengeMethodPasskey, FlowChallengeMethodPasskeyRegister}
	for kind, handler := range actionKindHandlers {
		if kind == domain.FlowActionKindPasskeyRegister {
			continue
		}
		for _, pendingMethod := range methods {
			for _, responseMethod := range methods {
				state := &domain.FlowState{}
				if pendingMethod != "" {
					state.PendingChallenge = &domain.FlowPendingChallenge{ID: "challenge-1", Method: pendingMethod}
				}
				in := FlowSubmitInput{}
				if responseMethod != "" {
					in.ChallengeResponse = &FlowChallengeResponse{ChallengeID: "challenge-1", Method: responseMethod}
				}
				assert.False(t, handler.acceptsSignupProof(state, in),
					"kind %s, pending %q, response %q", kind, pendingMethod, responseMethod)
			}
		}
	}
}
