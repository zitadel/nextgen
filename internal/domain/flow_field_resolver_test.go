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
			// `email` would mean contact information. The identifier is the
			// half of a credential, so it takes the pairing token whatever
			// its type — and matches the hidden control on the password step.
			name:    "an email-typed identifier still takes the username token",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengeIdentifier, Type: domain.FlowFieldTypeEmail},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    domain.AutocompleteUsername,
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
			// Unmapped on purpose: a step-up prompt asks the user to confirm
			// the password they already have, so "new-password" would tell a
			// manager to replace it. No token beats the wrong one.
			name:    "a password under reauth takes no token until that journey maps one",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeReauth,
			want:    "",
		},
		{
			name:    "a password under link_account takes no token",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeLinkAccount,
			want:    "",
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

func TestPasswordValidationForField(t *testing.T) {
	t.Parallel()

	password := domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword}
	chosen := &domain.FlowFieldValidation{MinLength: domain.PasswordMinLength}
	schemaRules := &domain.FlowFieldValidation{MinLength: 3, MaxLength: 20}

	tests := []struct {
		name    string
		field   domain.FlowField
		purpose domain.FlowDefinitionPurpose
		want    *domain.FlowFieldValidation
	}{
		{
			// A sign-in password is checked, not chosen: a length rule would
			// turn away a short legacy password before it is verified.
			name:    "a password the engine verifies carries no length rule",
			field:   password,
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    nil,
		},
		{
			name:    "a password the user chooses at registration carries the minimum",
			field:   password,
			purpose: domain.FlowDefinitionPurposeRegister,
			want:    chosen,
		},
		{
			name:    "a password the user chooses in recovery carries the minimum",
			field:   password,
			purpose: domain.FlowDefinitionPurposeRecovery,
			want:    chosen,
		},
		{
			name:    "a password under reauth carries no length rule",
			field:   password,
			purpose: domain.FlowDefinitionPurposeReauth,
			want:    nil,
		},
		{
			name:    "a password under link_account carries no length rule",
			field:   password,
			purpose: domain.FlowDefinitionPurposeLinkAccount,
			want:    nil,
		},
		{
			name:    "a plain property keeps its schema rules under login",
			field:   domain.FlowField{Name: "username", Type: domain.FlowFieldTypeText, Validation: schemaRules},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    schemaRules,
		},
		{
			name:    "a plain property keeps its schema rules under register",
			field:   domain.FlowField{Name: "username", Type: domain.FlowFieldTypeText, Validation: schemaRules},
			purpose: domain.FlowDefinitionPurposeRegister,
			want:    schemaRules,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, domain.PasswordValidationForField(tc.field, tc.purpose))
		})
	}
}
