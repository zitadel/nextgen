package flowdefinition_test

import (
	"testing"
	"time"

	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

// Transition action and purpose both survive the Marshal → ToDomain round
// trip; a plain step transition keeps both pointers nil.
func TestContent_TransitionRoundTrip_PreservesActionAndPurpose(t *testing.T) {
	t.Parallel()

	now := time.Unix(1700000000, 0).UTC()
	def := &domain.FlowDefinition{
		ProjectID:  "proj-1",
		ID:         "flow-1",
		Name:       "combined",
		UserSchema: "https://tenant.com/schemas/user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identifier",
			domain.FlowDefinitionPurposeRegister: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "register", Kind: domain.FlowActionKindNavigate},
					{Name: "recover", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit":   {Target: "done"},
					"register": {Target: "register", Purpose: gu.Ptr(domain.FlowDefinitionPurposeRegister)},
					"recover":  {Target: "recovery-flow", Action: gu.Ptr(domain.Pivot)},
				},
			},
			{
				Name:   "register",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}

	raw, err := flowdefinition.Marshal(def)
	require.NoError(t, err)

	got, err := flowdefinition.ToDomain(
		def.ProjectID, def.ID, def.Name, def.SchemaVersion,
		def.Status, now, now, raw,
	)
	require.NoError(t, err)

	identifier, ok := got.FindStep("identifier")
	require.True(t, ok)

	purposed := identifier.Transitions["register"]
	require.NotNil(t, purposed.Purpose)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, *purposed.Purpose)
	assert.Nil(t, purposed.Action)
	assert.Equal(t, "register", purposed.Target)

	pivot := identifier.Transitions["recover"]
	require.NotNil(t, pivot.Action)
	assert.Equal(t, domain.Pivot, *pivot.Action)
	assert.Nil(t, pivot.Purpose)

	plain := identifier.Transitions["submit"]
	assert.Nil(t, plain.Action)
	assert.Nil(t, plain.Purpose)
}

// An unknown purpose string in stored JSON is a decode error, not a
// silent default.
func TestContent_UnknownTransitionPurposeRejected(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"user_schema": "https://tenant.com/schemas/user.json",
		"purposes": {"login": "identifier"},
		"steps": [{
			"name": "identifier",
			"transitions": {"next": {"target": "identifier", "purpose": "shopping"}}
		}]
	}`)

	_, err := flowdefinition.ToDomain(
		"proj-1", "flow-1", "combined", "1",
		domain.FlowDefinitionStatusActive, time.Unix(1700000000, 0), time.Unix(1700000000, 0), raw,
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), `invalid purpose "shopping"`)
}
