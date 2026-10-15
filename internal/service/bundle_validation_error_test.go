package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestBundleValidationError(t *testing.T) {
	t.Parallel()

	err := &service.BundleValidationError{
		Resources: []service.BundleResourceFailure{
			{
				Kind:   domain.ReleasePointerKindSchema,
				Index:  0,
				Handle: "human-user",
				Err:    domain.ErrJSONSchemaInvalid().WithMessage("bad schema"),
			},
			{
				Kind:   domain.ReleasePointerKindFlowDefinition,
				Index:  1,
				Handle: "login",
				Err:    domain.ErrFlowDefinitionInvalid("no purposes", nil),
			},
		},
	}
	require.Error(t, err)
	assert.Contains(t, err.Error(), "schema[0]")
	assert.Contains(t, err.Error(), "flow_definition[1]")
	assert.Len(t, err.Resources, 2)
}
