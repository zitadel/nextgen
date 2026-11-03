package resolver

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDecision_String(t *testing.T) {
	assert.Equal(t, "allow", DecisionAllow.String())
	assert.Equal(t, "not_found", DecisionNotFound.String())
	assert.Equal(t, "forbidden", DecisionForbidden.String())
	assert.Equal(t, "unspecified", DecisionUnspecified.String())
}
