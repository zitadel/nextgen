package domain_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestFlowDefinition_InitialStepFor(t *testing.T) {
	def := &domain.FlowDefinition{
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "credentials",
			domain.FlowDefinitionPurposeLogin:    "identify",
		},
	}

	if got, ok := def.InitialStepFor(domain.FlowDefinitionPurposeRegister); !ok || got != "credentials" {
		t.Errorf("InitialStepFor(register) = (%q, %v), want (credentials, true)", got, ok)
	}
	if got, ok := def.InitialStepFor(domain.FlowDefinitionPurposeRecovery); ok || got != "" {
		t.Errorf("InitialStepFor(recovery) = (%q, %v), want (\"\", false)", got, ok)
	}
}

func TestFlowDefinition_FindStep(t *testing.T) {
	def := &domain.FlowDefinition{
		Steps: []domain.FlowDefinitionStep{
			{Name: "credentials"},
			{Name: "done"},
		},
	}

	got, ok := def.FindStep("done")
	if !ok {
		t.Fatalf("FindStep(done) ok = false, want true")
	}
	if got != &def.Steps[1] {
		t.Errorf("FindStep(done) = %p, want pointer into def.Steps[1] (%p)", got, &def.Steps[1])
	}

	if got, ok := def.FindStep("missing"); ok || got != nil {
		t.Errorf("FindStep(missing) = (%v, %v), want (nil, false)", got, ok)
	}
}
