package api

import (
	"testing"

	"github.com/stretchr/testify/require"

	apigen "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestToFlowField_OmitsValidationWhenAbsent(t *testing.T) {
	t.Parallel()

	got := toFlowField(domain.FlowField{
		Type:    domain.FlowFieldTypeText,
		TextKey: "step.field.x",
	})

	require.False(t, got.Validation.Set)
}

func TestToFlowField_EmitsFormatLengths(t *testing.T) {
	t.Parallel()

	got := toFlowField(domain.FlowField{
		Type:    domain.FlowFieldTypeEmail,
		TextKey: "step.field.email",
		Validation: &domain.FlowFieldValidation{
			Format:    "email",
			MinLength: 3,
			MaxLength: 200,
		},
	})

	require.True(t, got.Validation.Set)
	v := got.Validation.Value
	require.Equal(t, apigen.FieldValidationFormatEmail, v.Format.Value)
	require.Equal(t, 3, v.MinLength.Value)
	require.Equal(t, 200, v.MaxLength.Value)
}

func TestToFlowField_DropsUnknownFormat(t *testing.T) {
	t.Parallel()

	got := toFlowField(domain.FlowField{
		Type:    domain.FlowFieldTypeText,
		TextKey: "step.field.x",
		Validation: &domain.FlowFieldValidation{
			Format: "phone",
		},
	})

	require.False(t, got.Validation.Set, "validation block omitted when only key would be an unknown format")
}

func TestToFlowField_UUIDFormatSurfacesAsText(t *testing.T) {
	t.Parallel()

	got := toFlowField(domain.FlowField{
		Type:    domain.FlowFieldTypeText,
		TextKey: "step.field.id",
		Validation: &domain.FlowFieldValidation{
			Format: "uuid",
		},
	})

	require.Equal(t, apigen.FieldTypeText, got.Type)
	require.True(t, got.Validation.Set)
	require.Equal(t, apigen.FieldValidationFormatUUID, got.Validation.Value.Format.Value)
}

func TestToFlowField_EnumSurfaces(t *testing.T) {
	t.Parallel()

	got := toFlowField(domain.FlowField{
		Type:    domain.FlowFieldTypeSelect,
		TextKey: "step.field.maritalStatus",
		Validation: &domain.FlowFieldValidation{
			Enum: []string{"Single", "Married", "Divorced", "Widowed"},
		},
	})

	require.True(t, got.Validation.Set, "validation block emitted when only enum is set")
	require.Equal(t, []string{"Single", "Married", "Divorced", "Widowed"}, got.Validation.Value.Enum)
}

func TestValidateOriginAgainstProject(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		origin      string
		allowed     []string
		wantErr     bool
		wantInError []string
	}{
		{
			name:    "empty allowlist allows any origin",
			origin:  "http://127.0.0.1:3000",
			allowed: nil,
		},
		{
			name:    "exact match allows",
			origin:  "http://localhost:3000",
			allowed: []string{"http://localhost:3000"},
		},
		{
			name:    "loopback spellings are not aliased",
			origin:  "http://127.0.0.1:3000",
			allowed: []string{"http://localhost:3000", "https://app.example.com"},
			wantErr: true,
			wantInError: []string{
				`"http://127.0.0.1:3000"`,
				"http://localhost:3000, https://app.example.com",
			},
		},
		{
			name:    "ipv6 loopback is not aliased",
			origin:  "http://[::1]:3000",
			allowed: []string{"http://localhost:3000"},
			wantErr: true,
			wantInError: []string{
				`"http://[::1]:3000"`,
				"http://localhost:3000",
			},
		},
		{
			name:    "ipv6 exact match allows",
			origin:  "http://[::1]:3000",
			allowed: []string{"http://[::1]:3000"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			err := validateOriginAgainstProject(tc.origin, &domain.Project{PreviewOrigins: tc.allowed})

			if !tc.wantErr {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			for _, want := range tc.wantInError {
				require.Contains(t, err.Error(), want, "message must name the offending origin and the allowlist")
			}
		})
	}
}

// Explicit JSON `null` for a transition's action/purpose must map to "not
// set" — IsSet() alone is also true for ogen's explicit-null state, and
// reading .Value would silently yield the zero enum (switch / login).
func TestMapFlowDefinitionRequest_NullTransitionActionAndPurpose(t *testing.T) {
	t.Parallel()

	definition := apigen.FlowDefinition{
		Name:       "combined",
		UserSchema: "sch_test",
		Purposes:   apigen.FlowDefinitionPurposes{"login": "identifier"},
		Steps: []apigen.FlowDefinitionStep{
			{
				Name: "identifier",
				Transitions: apigen.NewOptFlowDefinitionStepTransitions(apigen.FlowDefinitionStepTransitions{
					"next": {
						Target:  "identifier",
						Action:  apigen.OptNilFlowDefinitionStepTransitionsItemAction{Set: true, Null: true},
						Purpose: apigen.OptNilFlowDefinitionStepTransitionsItemPurpose{Set: true, Null: true},
					},
					"purposed": {
						Target: "identifier",
						Purpose: apigen.NewOptNilFlowDefinitionStepTransitionsItemPurpose(
							apigen.FlowDefinitionStepTransitionsItemPurposeRegister,
						),
					},
				}),
			},
		},
	}

	svcReq, err := mapCreateRequestToService(&apigen.CreateFlowDefinitionRequest{ProjectID: "proj-1", FlowDefinition: definition})
	require.NoError(t, err)
	require.Len(t, svcReq.Steps, 1)

	nullBoth := svcReq.Steps[0].Transitions["next"]
	require.Nil(t, nullBoth.Action, "explicit null action must not map to the zero enum")
	require.Nil(t, nullBoth.Purpose, "explicit null purpose must not map to login")

	purposed := svcReq.Steps[0].Transitions["purposed"]
	require.NotNil(t, purposed.Purpose)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, *purposed.Purpose)
}
