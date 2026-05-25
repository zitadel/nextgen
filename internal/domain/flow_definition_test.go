package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestFlowDefinition_InitialStepFor(t *testing.T) {
	def := &domain.FlowDefinition{
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "credentials",
			domain.FlowDefinitionPurposeLogin:    "identify",
		},
	}

	got, ok := def.InitialStepFor(domain.FlowDefinitionPurposeRegister)
	assert.True(t, ok)
	assert.Equal(t, "credentials", got)

	got, ok = def.InitialStepFor(domain.FlowDefinitionPurposeRecovery)
	assert.False(t, ok)
	assert.Empty(t, got)
}

func TestFlowDefinition_FindStep(t *testing.T) {
	def := &domain.FlowDefinition{
		Steps: []domain.FlowDefinitionStep{
			{Name: "credentials"},
			{Name: "done"},
		},
	}

	got, ok := def.FindStep("done")
	require.True(t, ok)
	assert.Same(t, &def.Steps[1], got)

	got, ok = def.FindStep("missing")
	assert.False(t, ok)
	assert.Nil(t, got)
}
