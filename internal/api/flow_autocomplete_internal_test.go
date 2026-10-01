package api

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestToFlowField_CarriesAutocompleteWhenSet(t *testing.T) {
	t.Parallel()

	got := toFlowField(domain.FlowField{
		Name:         "x-auth-methods#password",
		Type:         domain.FlowFieldTypePassword,
		TextKey:      "password.field.password",
		Autocomplete: domain.AutocompleteCurrentPassword,
	})

	require.True(t, got.Autocomplete.Set)
	require.Equal(t, domain.AutocompleteCurrentPassword, got.Autocomplete.Value)
}

func TestToFlowField_OmitsAutocompleteWhenAbsent(t *testing.T) {
	t.Parallel()

	got := toFlowField(domain.FlowField{
		Name:    "given_name",
		Type:    domain.FlowFieldTypeText,
		TextKey: "register.field.given_name",
	})

	require.False(t, got.Autocomplete.Set)
}

func TestToFlowStep_CarriesThePairedIdentifier(t *testing.T) {
	t.Parallel()

	got := toFlowStep(&domain.FlowStep{
		Name: "password",
		Identifier: &domain.FlowStepIdentifier{
			Name:         "email",
			Value:        "alice@example.com",
			Autocomplete: domain.AutocompleteUsername,
		},
	})

	require.True(t, got.Identifier.Set)
	require.Equal(t, "email", got.Identifier.Value.Name)
	require.Equal(t, "alice@example.com", got.Identifier.Value.Value)
	require.Equal(t, domain.AutocompleteUsername, got.Identifier.Value.Autocomplete)
}

func TestToFlowStep_OmitsThePairedIdentifierWhenAbsent(t *testing.T) {
	t.Parallel()

	got := toFlowStep(&domain.FlowStep{Name: "identifier"})

	require.False(t, got.Identifier.Set)
}
