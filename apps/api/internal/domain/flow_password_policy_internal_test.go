package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The purposes that choose a password are exactly the ones whose form asks
// for a new one today, but the two are separate fields: an autofill change
// must not switch length enforcement on or off.
func TestChoosesPassword(t *testing.T) {
	assert.True(t, ChoosesPassword(FlowDefinitionPurposeRegister))
	assert.True(t, ChoosesPassword(FlowDefinitionPurposeRecovery))
	assert.False(t, ChoosesPassword(FlowDefinitionPurposeLogin))
	assert.False(t, ChoosesPassword(FlowDefinitionPurposeReauth), "an unlisted purpose does not choose")
}
