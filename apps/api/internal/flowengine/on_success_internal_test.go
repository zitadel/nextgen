package flowengine

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

// Every on_success value has a handler, so no step a valid definition
// declares fails its submit as not wired.
func TestOnSuccessHandlers_OnePerValue(t *testing.T) {
	for _, value := range domain.FlowOnSuccessValues() {
		_, ok := onSuccessHandlers[value]
		assert.True(t, ok, "handler for on_success %s", value)
	}
	assert.Len(t, onSuccessHandlers, len(domain.FlowOnSuccessValues()))
}
