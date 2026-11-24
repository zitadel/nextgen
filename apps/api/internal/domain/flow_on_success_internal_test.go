package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Every on_success value is declared: a missing one would read as the zero
// spec, and the validator would skip its manifest.
func TestFlowOnSuccessSpecs_OnePerValue(t *testing.T) {
	for _, value := range FlowOnSuccessValues() {
		_, ok := flowOnSuccessSpecs[value]
		assert.True(t, ok, "spec for on_success %s", value)
	}
	assert.Len(t, flowOnSuccessSpecs, len(FlowOnSuccessValues()))
}
