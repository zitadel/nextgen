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

// Steps reference identity provider connections by slug: Marshal stores the
// slugs as given, in order, and ToDomain reads them back unchanged.
func TestContent_SSOProvidersRoundTrip_StoresSlugs(t *testing.T) {
	t.Parallel()

	now := time.Unix(1700000000, 0).UTC()
	def := &domain.FlowDefinition{
		ProjectID:  "proj-1",
		ID:         "flow-1",
		Name:       "login",
		UserSchema: "https://tenant.com/schemas/user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "identifier",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:         "identifier",
				SSOProviders: []string{"google", "corp_idp"},
				Transitions: map[string]domain.FlowStepTransition{
					"callback": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteRedirect)},
		},
	}

	raw, err := flowdefinition.Marshal(def)
	require.NoError(t, err)
	assert.Contains(t, string(raw), `"sso_providers":["google","corp_idp"]`)

	got, err := flowdefinition.ToDomain(
		def.ProjectID, def.ID, def.Name, "1",
		domain.FlowDefinitionStatusActive, now, now, raw,
	)
	require.NoError(t, err)
	assert.Equal(t, []string{"google", "corp_idp"}, got.Steps[0].SSOProviders)
}

// Revisions are immutable, and those stored before steps referenced
// connections by slug hold {id, name, template} objects. They still load,
// each object read as its id.
func TestContent_LegacySSOProviderObjectsDecodeAsSlugs(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"user_schema": "https://tenant.com/schemas/user.json",
		"purposes": {"login": "identifier"},
		"steps": [{
			"name": "identifier",
			"sso_providers": [
				{"id": "google", "name": "Google", "template": "google"},
				"corp_idp"
			],
			"transitions": {"callback": {"target": "identifier"}}
		}]
	}`)

	got, err := flowdefinition.ToDomain(
		"proj-1", "flow-1", "login", "1",
		domain.FlowDefinitionStatusActive, time.Unix(1700000000, 0), time.Unix(1700000000, 0), raw,
	)
	require.NoError(t, err)
	assert.Equal(t, []string{"google", "corp_idp"}, got.Steps[0].SSOProviders)
}

// An sso_providers entry that is neither a slug nor an object is a decode
// error, not an empty slug.
func TestContent_MalformedSSOProviderRejected(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"user_schema": "https://tenant.com/schemas/user.json",
		"purposes": {"login": "identifier"},
		"steps": [{"name": "identifier", "sso_providers": [42]}]
	}`)

	_, err := flowdefinition.ToDomain(
		"proj-1", "flow-1", "login", "1",
		domain.FlowDefinitionStatusActive, time.Unix(1700000000, 0), time.Unix(1700000000, 0), raw,
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "want a connection slug or an {id} object")
}
