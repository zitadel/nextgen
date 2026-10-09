package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// Examples in a schema are the first thing a reader copies, so an example the
// schema itself would reject is worse than no example at all. This reads the
// contract file rather than restating its values, so adding one that does not
// validate fails here instead of shipping.
func TestBrandingColorExamplesAreValid(t *testing.T) {
	var schema struct {
		Examples []string `yaml:"examples"`
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "api", "openapi", "components", "flows", "branding-color.yaml"))
	require.NoError(t, err)
	require.NoError(t, yaml.Unmarshal(raw, &schema))
	require.NotEmpty(t, schema.Examples, "branding-color.yaml should carry examples")

	for _, example := range schema.Examples {
		t.Run(example, func(t *testing.T) {
			require.NoError(t, api.BrandingColor(example).Validate(),
				"the contract pattern rejects its own example")
			require.NoError(t, domain.ValidateBrandingColor("palette.primary", example),
				"the save gate rejects an example the contract advertises")
		})
	}
}
