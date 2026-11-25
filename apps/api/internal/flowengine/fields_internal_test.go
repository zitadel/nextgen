package flowengine

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

// The bounds are set on the validation the field already carries, so a rule
// attached at resolve time survives.
func TestWithPasswordBounds(t *testing.T) {
	assert.Equal(t, &domain.FlowFieldValidation{MinLength: 12, MaxLength: 32}, withPasswordBounds(nil, 12, 32))

	existing := &domain.FlowFieldValidation{Format: "uuid", MinLength: 1}
	got := withPasswordBounds(existing, 12, 32)
	assert.Equal(t, &domain.FlowFieldValidation{Format: "uuid", MinLength: 12, MaxLength: 32}, got)
	assert.Equal(t, 1, existing.MinLength, "the resolved validation is not mutated")
}
