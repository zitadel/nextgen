package policy_test

import (
	"encoding/json"
	"os"
	"testing"

	"cel.dev/cel-go/cel"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/policy"
)

// normalizedExpression parses a CEL expression and prints it back, so
// whitespace and redundant parentheses do not count as a change.
func normalizedExpression(t *testing.T, expr string) string {
	t.Helper()
	env, err := cel.NewEnv()
	require.NoError(t, err)
	parsed, iss := env.Parse(expr)
	require.NoError(t, iss.Err(), expr)
	out, err := cel.AstToString(parsed)
	require.NoError(t, err, expr)
	return out
}

func TestNormalizedExpression(t *testing.T) {
	assert.Equal(t,
		normalizedExpression(t, "config.min_length <= config.max_length"),
		normalizedExpression(t, "(config.min_length)  <=\n config.max_length"))
	assert.NotEqual(t,
		normalizedExpression(t, "config.min_length <= config.max_length"),
		normalizedExpression(t, "config.min_length < config.max_length"))
}

// compatRecord is what stored instances may depend on, per operation.
type compatRecord struct {
	Settings    map[string]policy.Setting `json:"settings"`
	ConfigRules map[string]string         `json:"config_rules"`
}

// TestTemplates_StayCompatible guards stored instances across server
// upgrades. An instance is validated when it is published and bound again
// whenever it is resolved, so a template that removes a setting, changes its
// type, narrows its bounds, or adds or changes a config rule would turn an
// instance that was valid into one that fails every evaluation of its
// operation.
//
// testdata/settings_compat.json records the settings an instance may hold and
// the config rules it was checked against. A template may widen a bound, add
// a setting or drop a config rule, and the record follows. Anything that
// rejects more fails here and needs a migration of stored instances first.
func TestTemplates_StayCompatible(t *testing.T) {
	data, err := os.ReadFile("testdata/settings_compat.json")
	require.NoError(t, err)
	var recorded map[string]compatRecord
	require.NoError(t, json.Unmarshal(data, &recorded))

	e, err := policy.New()
	require.NoError(t, err)

	for operation, record := range recorded {
		tpl, err := e.Template(operation)
		require.NoError(t, err, "operation %q was removed", operation)
		for name, was := range record.Settings {
			now, ok := tpl.Config[name]
			if !assert.True(t, ok, "%s: setting %q was removed", operation, name) {
				continue
			}
			assert.Equal(t, was.Type, now.Type, "%s: setting %q changed type", operation, name)
			if was.Minimum == nil {
				assert.Nil(t, now.Minimum, "%s: setting %q gained a minimum", operation, name)
			} else if now.Minimum != nil {
				assert.LessOrEqual(t, *now.Minimum, *was.Minimum, "%s: minimum of %q was raised", operation, name)
			}
			if was.Maximum == nil {
				assert.Nil(t, now.Maximum, "%s: setting %q gained a maximum", operation, name)
			} else if now.Maximum != nil {
				assert.GreaterOrEqual(t, *now.Maximum, *was.Maximum, "%s: maximum of %q was lowered", operation, name)
			}
		}
		for _, rule := range tpl.ConfigRules {
			was, ok := record.ConfigRules[rule.Name]
			if assert.True(t, ok, "%s: config rule %q is new and may reject stored instances", operation, rule.Name) {
				assert.Equal(t, normalizedExpression(t, was), normalizedExpression(t, rule.Expression),
					"%s: config rule %q changed and may reject stored instances", operation, rule.Name)
			}
		}
	}

	// Every catalogued setting is recorded, so a new one cannot be narrowed
	// before anyone notices it needs protecting.
	for _, operation := range e.Operations() {
		tpl, err := e.Template(operation)
		require.NoError(t, err)
		for name := range tpl.Config {
			assert.Contains(t, recorded[operation].Settings, name, "%s: setting %q is not recorded in testdata/settings_compat.json", operation, name)
		}
	}
}
