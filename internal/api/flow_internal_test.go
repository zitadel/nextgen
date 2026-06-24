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
