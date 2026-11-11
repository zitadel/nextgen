package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The purposes that choose a password are exactly the ones whose form asks
// for a new one today, but the two are separate fields: an autofill change
// must not switch length enforcement on or off.
func TestChoosesPassword(t *testing.T) {
	assert.True(t, choosesPassword(FlowDefinitionPurposeRegister))
	assert.True(t, choosesPassword(FlowDefinitionPurposeRecovery))
	assert.False(t, choosesPassword(FlowDefinitionPurposeLogin))
	assert.False(t, choosesPassword(FlowDefinitionPurposeReauth), "an unlisted purpose does not choose")
}

// The bounds are set on the validation the field already carries, so a rule
// attached at resolve time survives.
func TestWithPasswordBounds(t *testing.T) {
	assert.Equal(t, &FlowFieldValidation{MinLength: 12, MaxLength: 32}, withPasswordBounds(nil, 12, 32))

	existing := &FlowFieldValidation{Format: "uuid", MinLength: 1}
	got := withPasswordBounds(existing, 12, 32)
	assert.Equal(t, &FlowFieldValidation{Format: "uuid", MinLength: 12, MaxLength: 32}, got)
	assert.Equal(t, 1, existing.MinLength, "the resolved validation is not mutated")
}
