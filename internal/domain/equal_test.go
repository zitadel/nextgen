package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestFlowDefinition_Equal(t *testing.T) {
	t.Parallel()

	base := &domain.FlowDefinition{
		ProjectID:  "prj_a",
		ID:         "flowdef_1",
		Name:       "default-login",
		Status:     domain.FlowDefinitionStatusActive,
		UserSchema: "human-user",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "credentials",
		},
		Audience: domain.FlowDefinitionAudience{AppIDs: []string{"app_1"}},
		Steps: []domain.FlowDefinitionStep{
			{Name: "credentials", Fields: []domain.Field{"email"}},
		},
		CreatedAt: time.Unix(1, 0),
		UpdatedAt: time.Unix(2, 0),
	}

	t.Run("same content different identity", func(t *testing.T) {
		t.Parallel()
		other := *base
		other.ProjectID = "prj_b"
		other.ID = "flowdef_2"
		other.CreatedAt = time.Unix(99, 0)
		other.UpdatedAt = time.Unix(100, 0)
		other.SchemaVersion = "v2"
		assert.True(t, base.Equal(&other))
	})

	t.Run("nil and empty purposes match via maps.Equal", func(t *testing.T) {
		t.Parallel()
		a := *base
		a.Purposes = nil
		b := *base
		b.Purposes = map[domain.FlowDefinitionPurpose]string{}
		assert.True(t, a.Equal(&b))
	})

	t.Run("nil and empty audience slices match", func(t *testing.T) {
		t.Parallel()
		a := *base
		a.Audience = domain.FlowDefinitionAudience{}
		b := *base
		b.Audience = domain.FlowDefinitionAudience{AppIDs: []string{}, TeamIDs: []string{}}
		assert.True(t, a.Equal(&b))
	})

	t.Run("name difference", func(t *testing.T) {
		t.Parallel()
		other := *base
		other.Name = "other"
		assert.False(t, base.Equal(&other))
	})

	t.Run("nil receivers", func(t *testing.T) {
		t.Parallel()
		var nilDef *domain.FlowDefinition
		assert.True(t, nilDef.Equal(nil))
		assert.False(t, nilDef.Equal(base))
		assert.False(t, base.Equal(nil))
	})

	t.Run("nil and empty step actions match", func(t *testing.T) {
		t.Parallel()
		a := *base
		a.Steps = []domain.FlowDefinitionStep{{
			Name:    "done",
			Actions: nil,
			Complete: new(domain.FlowStepCompleteRedirect),
		}}
		b := *base
		b.Steps = []domain.FlowDefinitionStep{{
			Name:    "done",
			Actions: []domain.FlowStepAction{},
			Complete: new(domain.FlowStepCompleteRedirect),
		}}
		assert.True(t, a.Equal(&b))
	})
}

func TestBranding_Equal(t *testing.T) {
	t.Parallel()

	base := &domain.Branding{
		ProjectID:      "prj_a",
		ID:             "brnd_1",
		Layout:         domain.BrandingLayoutCentered,
		LiquidTemplate: "{{ content }}",
		LogoURL:        "https://example.com/logo.png",
		HeroURL:        "https://example.com/hero.png",
		Theme: domain.BrandingTheme{
			Mode: domain.BrandingThemeLight,
			Light: &domain.BrandingThemeSide{
				Palette: &domain.BrandingPalette{Primary: "#111111"},
			},
		},
		Typography: domain.BrandingTypography{FontFamily: "Inter", Scale: 1},
		Shape:      domain.BrandingShape{Density: domain.BrandingDensityRegular},
		CreatedAt:  time.Unix(1, 0),
	}

	t.Run("same content different identity", func(t *testing.T) {
		t.Parallel()
		other := *base
		other.ProjectID = "prj_b"
		other.ID = "brnd_2"
		other.CreatedAt = time.Unix(99, 0)
		assert.True(t, base.Equal(&other))
	})

	t.Run("layout difference", func(t *testing.T) {
		t.Parallel()
		other := *base
		other.Layout = domain.BrandingLayoutSplit
		assert.False(t, base.Equal(&other))
	})

	t.Run("theme difference", func(t *testing.T) {
		t.Parallel()
		other := *base
		other.Theme.Mode = domain.BrandingThemeDark
		assert.False(t, base.Equal(&other))
	})

	t.Run("nil receivers", func(t *testing.T) {
		t.Parallel()
		var nilBranding *domain.Branding
		assert.True(t, nilBranding.Equal(nil))
		assert.False(t, nilBranding.Equal(base))
		assert.False(t, base.Equal(nil))
	})
}
