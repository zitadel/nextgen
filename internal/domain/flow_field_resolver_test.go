package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAutocompleteForField(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		field   domain.FlowField
		purpose domain.FlowDefinitionPurpose
		want    string
	}{
		{
			name:    "an email-typed identifier takes the email token",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengeIdentifier, Type: domain.FlowFieldTypeEmail},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    domain.AutocompleteEmail,
		},
		{
			name:    "a text-typed identifier takes the username token",
			field:   domain.FlowField{Name: "handle", Challenge: domain.FlowFieldChallengeIdentifier, Type: domain.FlowFieldTypeText},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    domain.AutocompleteUsername,
		},
		{
			name:    "a password the engine verifies takes current-password",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    domain.AutocompleteCurrentPassword,
		},
		{
			name:    "a password the engine saves takes new-password",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeRegister,
			want:    domain.AutocompleteNewPassword,
		},
		{
			name:    "a recovery password is a new one too",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeRecovery,
			want:    domain.AutocompleteNewPassword,
		},
		{
			name:    "a plain property takes no token",
			field:   domain.FlowField{Name: "given_name", Type: domain.FlowFieldTypeText},
			purpose: domain.FlowDefinitionPurposeRegister,
			want:    "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, domain.AutocompleteForField(tc.field, tc.purpose))
		})
	}
}
