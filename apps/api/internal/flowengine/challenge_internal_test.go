package flowengine

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// Every ceremony a step can carry has a declaration, and the params it issues
// with are of the check it verifies as, so the attempt service verifies the
// challenge it issued.
func TestChallengeMethods_IssueAndVerifyTheSameCheck(t *testing.T) {
	methods := []string{FlowChallengeMethodPasskey, FlowChallengeMethodPasskeyRegister}
	assert.Len(t, challengeMethods, len(methods))
	for _, method := range methods {
		declared, ok := challengeMethods[method]
		require.True(t, ok, "declaration for %s", method)
		pc := &processCtx{
			state: &domain.FlowState{},
			in:    FlowSubmitInput{PasskeyRP: &FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}}},
		}
		params, err := declared.params(pc, domain.FlowResolvedFields{})
		require.NoError(t, err, method)
		assert.Equal(t, declared.check, params.CheckType(), method)
	}
}

// A proof naming no declared method is verified as a passkey assertion.
func TestChallengeMethodFor_UndeclaredIsPasskey(t *testing.T) {
	for _, method := range []string{"", "otp"} {
		assert.Equal(t, domain.AuthCheckTypePasskey, challengeMethodFor(method).check, "method %q", method)
	}
	assert.Equal(t, domain.AuthCheckTypePasskeyRegistration, challengeMethodFor(FlowChallengeMethodPasskeyRegister).check)
}
