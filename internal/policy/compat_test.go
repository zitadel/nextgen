package policy_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/policy"
)

// TestTemplates_StayCompatible guards stored instances across server
// upgrades. An instance is validated when it is published and bound again
// whenever it is resolved, so a template that removes a setting, changes its
// type or narrows its bounds would turn an instance that was valid into one
// that fails every evaluation of its operation.
//
// testdata/settings_compat.json records every setting an instance may hold.
// A template may widen a bound or add a setting; updating the record to the
// wider bound is then allowed. Narrowing or removing anything fails here and
// needs a migration of stored instances first.
func TestTemplates_StayCompatible(t *testing.T) {
	data, err := os.ReadFile("testdata/settings_compat.json")
	require.NoError(t, err)
	var recorded map[string]map[string]policy.Setting
	require.NoError(t, json.Unmarshal(data, &recorded))

	e, err := policy.New()
	require.NoError(t, err)

	for operation, settings := range recorded {
		tpl, err := e.Template(operation)
		require.NoError(t, err, "operation %q was removed", operation)
		for name, was := range settings {
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
	}

	// Every catalogued setting is recorded, so a new one cannot be narrowed
	// before anyone notices it needs protecting.
	for _, operation := range e.Operations() {
		tpl, err := e.Template(operation)
		require.NoError(t, err)
		for name := range tpl.Config {
			assert.Contains(t, recorded[operation], name, "%s: setting %q is not recorded in testdata/settings_compat.json", operation, name)
		}
	}
}
