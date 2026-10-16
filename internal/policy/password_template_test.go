package policy_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
)

const passwordSet = "auth.factor.password.set"

func passwordInstance(t *testing.T, config string) *policy.Instance {
	t.Helper()
	inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"auth.factor.password.set","config":` + config + `}`))
	require.NoError(t, err)
	return inst
}

func passwordContext(length int, historyMatches ...bool) map[string]any {
	if historyMatches == nil {
		historyMatches = []bool{}
	}
	return map[string]any{
		"candidate":       map[string]any{"length": length},
		"history_matches": historyMatches,
	}
}

func TestEmbeddedCatalog(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)
	assert.Equal(t, []string{passwordSet}, e.Operations())
}

// The template's bounds are the server's technical limits. Raising one in the
// domain without the template, or the other way round, would let a policy
// ask for something the server does not do.
func TestPasswordTemplate_BoundsMatchDomain(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)
	tpl, err := e.Template(passwordSet)
	require.NoError(t, err)

	for _, name := range []string{"min_length", "max_length"} {
		require.NotNil(t, tpl.Config[name].Maximum, name)
		assert.EqualValues(t, domain.MaxPasswordLength, *tpl.Config[name].Maximum, name)
	}

	// history_depth counts the current password; UserPasswordHistoryDepth
	// still counts only the previous ones storage returns. Storage can
	// therefore supply the current password plus that many, and the template
	// must not ask for more. Tighten to equality once the constant counts the
	// current password too.
	require.NotNil(t, tpl.Config["history_depth"].Maximum)
	assert.LessOrEqual(t, *tpl.Config["history_depth"].Maximum, int64(domain.UserPasswordHistoryDepth)+1)
}

func TestPasswordSet_Evaluate(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)

	tests := []struct {
		name           string
		config         string // nil instance when empty
		context        map[string]any
		wantViolations map[string]any
	}{
		{
			name:    "no instance enforces nothing and needs no context",
			context: nil,
		},
		{
			name:    "empty config enforces nothing",
			config:  `{}`,
			context: nil,
		},
		{
			name:           "too short",
			config:         `{"min_length":12}`,
			context:        passwordContext(11),
			wantViolations: map[string]any{"min_length": int64(12)},
		},
		{
			name:    "exactly the minimum",
			config:  `{"min_length":12}`,
			context: passwordContext(12),
		},
		{
			name:    "minimum alone does not cap the length",
			config:  `{"min_length":12}`,
			context: passwordContext(500),
		},
		{
			name:    "history off needs no history matches",
			config:  `{"min_length":1}`,
			context: map[string]any{"candidate": map[string]any{"length": 10}},
		},
		{
			name:           "too long",
			config:         `{"max_length":32}`,
			context:        passwordContext(33),
			wantViolations: map[string]any{"max_length": int64(32)},
		},
		{
			name:    "history off ignores matches",
			config:  `{"min_length":1}`,
			context: passwordContext(10, true),
		},
		{
			name:           "matches a kept password",
			config:         `{"history_depth":4}`,
			context:        passwordContext(10, false, true),
			wantViolations: map[string]any{"history_depth": int64(4)},
		},
		{
			name:    "no kept password matches",
			config:  `{"history_depth":4}`,
			context: passwordContext(10, false, false, false, false),
		},
		{
			name:           "more entries than the depth is a builder bug and denies",
			config:         `{"history_depth":1}`,
			context:        passwordContext(10, false, false),
			wantViolations: map[string]any{"history_depth": int64(1)},
		},
		{
			name:           "every active rule reports, no short-circuit",
			config:         `{"min_length":12,"max_length":32,"history_depth":4}`,
			context:        passwordContext(3, true),
			wantViolations: map[string]any{"min_length": int64(12), "history_depth": int64(4)},
		},
		{
			name:   "json-decoded context values are accepted",
			config: `{"min_length":12}`,
			context: map[string]any{
				"candidate":       map[string]any{"length": float64(16)},
				"history_matches": []any{false},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var inst *policy.Instance
			if tt.config != "" {
				inst = passwordInstance(t, tt.config)
			}
			b, err := e.Bind(t.Context(), passwordSet, inst)
			require.NoError(t, err)
			d, err := b.Evaluate(t.Context(), tt.context)
			require.NoError(t, err)
			assert.Equal(t, tt.wantViolations == nil, d.Allow)
			assert.Equal(t, tt.wantViolations, d.Violations)
		})
	}
}

func TestPasswordSet_Constraints(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)

	none, err := e.Bind(t.Context(), passwordSet, nil)
	require.NoError(t, err)
	noneConstraints, err := none.Constraints()
	require.NoError(t, err)
	assert.Empty(t, noneConstraints.Rules)
	assert.False(t, none.Active("history_depth"))

	b, err := e.Bind(t.Context(), passwordSet, passwordInstance(t, `{"min_length":12,"history_depth":4}`))
	require.NoError(t, err)
	got, err := b.Constraints()
	require.NoError(t, err)
	assert.Equal(t, policy.Constraints{
		Operation: passwordSet,
		Rules:     map[string]any{"min_length": int64(12), "history_depth": int64(4)},
	}, got)
	assert.True(t, b.Active("history_depth"))
}

func TestPasswordSet_ValidateInstance(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)

	valid := []string{
		`{}`,
		`{"min_length":1}`,
		`{"min_length":64,"max_length":64}`,
		`{"min_length":12,"max_length":32,"history_depth":4}`,
		`{"max_length":8}`,
	}
	for _, config := range valid {
		t.Run("valid "+config, func(t *testing.T) {
			require.NoError(t, e.ValidateInstance(t.Context(), passwordInstance(t, config)))
		})
	}

	invalid := map[string]string{
		"unknown setting":           `{"min_lenght":12}`,
		"min below the bound":       `{"min_length":0}`,
		"max above the domain cap":  `{"max_length":65}`,
		"history above the cap":     `{"history_depth":5}`,
		"history zero":              `{"history_depth":0}`,
		"not an integer":            `{"min_length":"12"}`,
		"fractional":                `{"min_length":12.5}`,
		"min above max":             `{"min_length":20,"max_length":10}`,
		"several problems reported": `{"min_length":0,"max_length":99}`,
	}
	for name, config := range invalid {
		t.Run(name, func(t *testing.T) {
			require.ErrorIs(t, e.ValidateInstance(t.Context(), passwordInstance(t, config)), policy.ErrInvalidInstance)
		})
	}

	err = e.ValidateInstance(t.Context(), passwordInstance(t, `{"min_length":0,"max_length":99}`))
	assert.ErrorContains(t, err, `"min_length"`)
	assert.ErrorContains(t, err, `"max_length"`)
}
