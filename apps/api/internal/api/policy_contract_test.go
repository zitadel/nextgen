package api

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/zitadel/nextgen/internal/policy"
)

const policySpecDir = "../../api/openapi/endpoints/policies"

// policyUnion is a oneOf keyed on `operation`, as the publish request and the
// policy response both are.
type policyUnion struct {
	Discriminator struct {
		PropertyName string            `yaml:"propertyName"`
		Mapping      map[string]string `yaml:"mapping"`
	} `yaml:"discriminator"`
}

// policyBranch is one operation's branch of a union.
type policyBranch struct {
	Properties struct {
		Operation struct {
			Enum []string `yaml:"enum"`
		} `yaml:"operation"`
		Config struct {
			Ref string `yaml:"$ref"`
		} `yaml:"config"`
	} `yaml:"properties"`
}

// policyConfig is an operation's typed config.
type policyConfig struct {
	AdditionalProperties *bool `yaml:"additionalProperties"`
	Properties           map[string]struct {
		Type    string `yaml:"type"`
		Minimum *int64 `yaml:"minimum"`
		Maximum *int64 `yaml:"maximum"`
	} `yaml:"properties"`
}

func readPolicySpec[T any](t *testing.T, name string) T {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(policySpecDir, name))
	require.NoError(t, err)
	var doc T
	require.NoError(t, yaml.Unmarshal(raw, &doc), name)
	return doc
}

// The publish request types each operation's config, and the template checks
// it again, so the two must agree: a setting the spec offers and the template
// lacks fails every publish that uses it, and one the template has and the
// spec lacks cannot be set. This pins both unions, the publish request and
// the policy response, to the catalogued operations, and each operation's
// typed config to exactly the template's settings, with the same types and
// bounds.
func TestPolicySpec_MatchesTemplates(t *testing.T) {
	engine, err := policy.New()
	require.NoError(t, err)

	for _, union := range []string{"publish-policy-request.yaml", "policy.yaml"} {
		t.Run(union, func(t *testing.T) {
			doc := readPolicySpec[policyUnion](t, union)
			require.Equal(t, "operation", doc.Discriminator.PropertyName)
			require.Equal(t, engine.Operations(), slices.Sorted(maps.Keys(doc.Discriminator.Mapping)),
				"the union and the catalog list different operations")

			for operation, file := range doc.Discriminator.Mapping {
				t.Run(operation, func(t *testing.T) {
					template, err := engine.Template(operation)
					require.NoError(t, err)

					branch := readPolicySpec[policyBranch](t, file)
					assert.Equal(t, []string{operation}, branch.Properties.Operation.Enum)
					require.NotEmpty(t, branch.Properties.Config.Ref, "%s has no typed config", file)

					config := readPolicySpec[policyConfig](t, branch.Properties.Config.Ref)
					require.NotNil(t, config.AdditionalProperties, "the config must state additionalProperties")
					assert.False(t, *config.AdditionalProperties, "the config must refuse settings the template lacks")
					require.Equal(t, slices.Sorted(maps.Keys(template.Config)), slices.Sorted(maps.Keys(config.Properties)),
						"the spec's settings differ from the template's")
					for name, setting := range template.Config {
						property := config.Properties[name]
						assert.Equal(t, string(setting.Type), property.Type, "%s: type", name)
						assert.Equal(t, setting.Minimum, property.Minimum, "%s: minimum", name)
						assert.Equal(t, setting.Maximum, property.Maximum, "%s: maximum", name)
					}
				})
			}
		})
	}
}
