package policy_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/policy"
)

func mustTemplate(t *testing.T, doc string) *policy.Template {
	t.Helper()
	tpl, err := policy.ParseTemplate([]byte(doc))
	require.NoError(t, err)
	return tpl
}

// testTemplate is a minimal valid template the failure cases below each
// break in one place.
const testTemplate = `{
  "operation": "test.op",
  "config": {
    "min": { "type": "integer", "minimum": 1, "maximum": 10 },
    "max": { "type": "integer", "minimum": 1, "maximum": 10 }
  },
  "config_rules": [ { "name": "min_not_above_max", "expression": "config.min <= config.max" } ],
  "context": { "value": "int", "flags": "list<bool>" },
  "rules": [
    { "name": "min", "expression": "value >= config.min" },
    { "name": "max", "expression": "value <= config.max" }
  ]
}`

func TestNew_TestTemplateCompiles(t *testing.T) {
	_, err := policy.New(policy.WithTemplates(mustTemplate(t, testTemplate)))
	require.NoError(t, err)
}

func TestNew_RejectsTemplate(t *testing.T) {
	tests := []struct {
		name    string
		replace [2]string
		limits  *policy.Limits
		wantErr string
	}{
		{
			name:    "rule does not return bool",
			replace: [2]string{`"value >= config.min"`, `"config.min"`},
			wantErr: "must evaluate to bool",
		},
		{
			name:    "rule references an unknown context field",
			replace: [2]string{`"value >= config.min"`, `"other >= config.min"`},
			wantErr: "undeclared reference",
		},
		{
			name:    "rule references an unknown setting",
			replace: [2]string{`"value >= config.min"`, `"value >= config.minimum"`},
			wantErr: "undeclared reference",
		},
		{
			name:    "rule reads two settings",
			replace: [2]string{`"value >= config.min"`, `"value >= config.min && value <= config.max"`},
			wantErr: "must read exactly the setting it is named after",
		},
		{
			name:    "rule reads no setting",
			replace: [2]string{`"value >= config.min"`, `"value >= 1"`},
			wantErr: "must read exactly the setting it is named after",
		},
		{
			name:    "rule not named after its setting",
			replace: [2]string{`{ "name": "min", "expression"`, `{ "name": "minimum", "expression"`},
			wantErr: "must read exactly the setting it is named after",
		},
		{
			name:    "config rule reads the context",
			replace: [2]string{`"config.min <= config.max"`, `"config.min <= value"`},
			wantErr: "undeclared reference",
		},
		{
			name:    "config rule reads no setting",
			replace: [2]string{`"config.min <= config.max"`, `"1 <= 2"`},
			wantErr: "reads no setting",
		},
		{
			name:    "expression too long",
			replace: [2]string{`"value >= config.min"`, `"value >= config.min` + strings.Repeat(" && true", 40) + `"`},
			wantErr: "limit is 256",
		},
		{
			name:    "estimated cost too high",
			replace: [2]string{`"value <= config.max"`, `"value <= config.max && flags.all(a, flags.all(b, a || b))"`},
			limits:  &policy.Limits{MaxExpressionLength: 256, MaxEstimatedCost: 100, MaxRuntimeCost: 100, MaxListSize: 64},
			wantErr: "estimated cost",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc := strings.Replace(testTemplate, tt.replace[0], tt.replace[1], 1)
			require.NotEqual(t, testTemplate, doc, "replacement did not apply")
			opts := []policy.Option{policy.WithTemplates(mustTemplate(t, doc))}
			if tt.limits != nil {
				opts = append(opts, policy.WithLimits(*tt.limits))
			}
			_, err := policy.New(opts...)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestParseTemplate_RejectsStructure(t *testing.T) {
	tests := []struct {
		name    string
		replace [2]string
		wantErr string
	}{
		{"missing operation", [2]string{`"operation": "test.op"`, `"operation": ""`}, "operation is required"},
		{"duplicate rule name", [2]string{`{ "name": "max", "expression"`, `{ "name": "min", "expression"`}, "duplicate name"},
		{"bounds on a boolean", [2]string{`"max": { "type": "integer"`, `"max": { "type": "boolean"`}, "bounds only apply to integers"},
		{"minimum above maximum", [2]string{`"minimum": 1, "maximum": 10 },
    "max"`, `"minimum": 11, "maximum": 10 },
    "max"`}, "minimum 11 is above maximum 10"},
		{"unsupported type", [2]string{`"max": { "type": "integer"`, `"max": { "type": "number"`}, "unsupported type"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc := strings.Replace(testTemplate, tt.replace[0], tt.replace[1], 1)
			require.NotEqual(t, testTemplate, doc, "replacement did not apply")
			_, err := policy.ParseTemplate([]byte(doc))
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestNew_RejectsDuplicateOperation(t *testing.T) {
	_, err := policy.New(policy.WithTemplates(mustTemplate(t, testTemplate), mustTemplate(t, testTemplate)))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate operation")
}

func TestEngine_UnknownOperation(t *testing.T) {
	e, err := policy.New(policy.WithTemplates(mustTemplate(t, testTemplate)))
	require.NoError(t, err)

	_, err = e.Evaluate(t.Context(), "nope", nil, nil)
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
	_, err = e.Constraints("nope", nil)
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
	err = e.ValidateInstance(&policy.Instance{Kind: policy.KindPolicy, Operation: "nope"})
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
}

func TestEvaluate_ContextMismatchFailsClosed(t *testing.T) {
	e, err := policy.New(policy.WithTemplates(mustTemplate(t, testTemplate)))
	require.NoError(t, err)
	inst := &policy.Instance{Kind: policy.KindPolicy, Operation: "test.op", Config: map[string]any{"min": 2}}

	tests := []struct {
		name    string
		context map[string]any
	}{
		{"missing field", map[string]any{"flags": []bool{}}},
		{"wrong type", map[string]any{"value": "3", "flags": []bool{}}},
		{"wrong list element", map[string]any{"value": 3, "flags": []any{"x"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := e.Evaluate(t.Context(), "test.op", inst, tt.context)
			require.ErrorIs(t, err, policy.ErrContextMismatch)
		})
	}
}

func TestParseInstance(t *testing.T) {
	inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"test.op","config":{"min":3}}`))
	require.NoError(t, err)
	assert.Equal(t, "test.op", inst.Operation)

	for name, doc := range map[string]string{
		"unknown field":     `{"kind":"policy","operation":"test.op","config":{},"audience":{}}`,
		"wrong kind":        `{"kind":"branding","operation":"test.op","config":{}}`,
		"missing operation": `{"kind":"policy","config":{}}`,
		"not json":          `{`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := policy.ParseInstance([]byte(doc))
			require.ErrorIs(t, err, policy.ErrInvalidInstance)
		})
	}
}
