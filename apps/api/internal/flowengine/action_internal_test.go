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
