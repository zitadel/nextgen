package policy_test

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"sync"
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
  "context": { "value": "int", "flags": "list<bool>", "counts": "list<int>" },
  "rules": [
    { "name": "min", "expression": "value >= config.min" },
    { "name": "max", "expression": "value <= config.max && counts.all(c, c <= config.max)" }
  ]
}`

func testEngine(t *testing.T) *policy.Engine {
	t.Helper()
	e, err := policy.New(policy.WithTemplates(mustTemplate(t, testTemplate)))
	require.NoError(t, err)
	return e
}

func bindTest(t *testing.T, e *policy.Engine, config map[string]any) *policy.Bound {
	t.Helper()
	b, err := e.Bind(t.Context(), "test.op", &policy.Instance{Kind: policy.KindPolicy, Operation: "test.op", Config: config})
	require.NoError(t, err)
	return b
}

func TestNew_TestTemplateCompiles(t *testing.T) {
	testEngine(t)
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
			name:    "setting no rule reads",
			replace: [2]string{`"max": { "type": "integer", "minimum": 1, "maximum": 10 }`, `"max": { "type": "integer", "minimum": 1, "maximum": 10 }, "unused": { "type": "boolean" }`},
			wantErr: `setting "unused": no rule reads it`,
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
			replace: [2]string{`"value <= config.max && counts.all(c, c <= config.max)"`, `"value <= config.max && flags.all(a, flags.all(b, a || b))"`},
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
		{"missing operation", [2]string{`"operation": "test.op"`, `"operation": ""`}, "area.resource.verb"},
		{"operation without a dot", [2]string{`"operation": "test.op"`, `"operation": "testop"`}, "area.resource.verb"},
		{"operation not snake_case", [2]string{`"operation": "test.op"`, `"operation": "Test.Op"`}, "area.resource.verb"},
		{"duplicate rule name", [2]string{`{ "name": "max", "expression"`, `{ "name": "min", "expression"`}, "duplicate name"},
		{"bounds on a boolean", [2]string{`"max": { "type": "integer"`, `"max": { "type": "boolean"`}, "bounds only apply to integers"},
		{"minimum above maximum", [2]string{`"minimum": 1, "maximum": 10 },
    "max"`, `"minimum": 11, "maximum": 10 },
    "max"`}, "minimum 11 is above maximum 10"},
		{"unsupported type", [2]string{`"max": { "type": "integer"`, `"max": { "type": "number"`}, "unsupported type"},
		{"string setting, which the cost estimator cannot bound", [2]string{`"max": { "type": "integer"`, `"max": { "type": "string"`}, "string settings are not supported"},
		{"setting not snake_case", [2]string{`"max": { "type"`, `"maxValue": { "type"`}, "names must be snake_case"},
		{"rule not snake_case", [2]string{`{ "name": "min_not_above_max"`, `{ "name": "Min-Not-Above"`}, "names must be snake_case"},
		{"context type CEL accepts but the engine cannot coerce", [2]string{`"counts": "list<int>"`, `"counts": "list<list<int>>"`}, "unsupported type"},
		{"misspelled top-level key", [2]string{`"config_rules"`, `"config_rule"`}, "unknown field"},
		{"marker the format does not have", [2]string{`"minimum": 1, "maximum": 10 },
    "max"`, `"minimum": 1, "maximum": 10, "default": 5 },
    "max"`}, "unknown field"},
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

func TestParseTemplate_RejectsDuplicateKeys(t *testing.T) {
	doc := strings.Replace(testTemplate, `"maximum": 10 },
    "max"`, `"maximum": 10, "maximum": 3 },
    "max"`, 1)
	require.NotEqual(t, testTemplate, doc)
	_, err := policy.ParseTemplate([]byte(doc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), `duplicate key "maximum"`)
}

func TestParseTemplate_RejectsCaseVariantKeys(t *testing.T) {
	for name, replace := range map[string][2]string{
		"envelope": {`"operation": "test.op"`, `"Operation": "test.op"`},
		"setting": {`"minimum": 1, "maximum": 10 },
    "max"`, `"minimum": 1, "Maximum": 10 },
    "max"`},
		"rule": {`{ "name": "min", "expression"`, `{ "name": "min", "Expression"`},
	} {
		t.Run(name, func(t *testing.T) {
			doc := strings.Replace(testTemplate, replace[0], replace[1], 1)
			require.NotEqual(t, testTemplate, doc)
			_, err := policy.ParseTemplate([]byte(doc))
			require.Error(t, err)
			assert.Contains(t, err.Error(), "unknown field")
		})
	}
}

func TestNew_RejectsShadowingComprehensionVariable(t *testing.T) {
	doc := strings.Replace(testTemplate,
		`"value <= config.max && counts.all(c, c <= config.max)"`,
		`"counts.all(value, value <= config.max)"`, 1)
	require.NotEqual(t, testTemplate, doc)
	_, err := policy.New(policy.WithTemplates(mustTemplate(t, doc)))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "shadow")
}

func TestParseTemplate_RejectsUnicodeCaseVariantKeys(t *testing.T) {
	// "rule\u017f" (long s) folds to "rules" in encoding/json without being
	// its lower case; it must count as a duplicate, not override the rules.
	doc := strings.Replace(testTemplate, `"rules": [`, `"rule\u017f": [], "rules": [`, 1)
	require.NotEqual(t, testTemplate, doc)
	_, err := policy.ParseTemplate([]byte(doc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate key")
}

func TestParseInstance_DuplicateKeysInNestedValues(t *testing.T) {
	// Same key in different objects, and inside arrays, is fine.
	_, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"test.op","config":{"a":{"x":1},"b":{"x":[{"x":1},{"x":2}]}}}`))
	require.NoError(t, err)
}

func TestParseTemplate_RejectsTrailingData(t *testing.T) {
	_, err := policy.ParseTemplate([]byte(testTemplate + " {}"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "after top-level value")
}

func TestNew_RejectsDuplicateOperation(t *testing.T) {
	_, err := policy.New(policy.WithTemplates(mustTemplate(t, testTemplate), mustTemplate(t, testTemplate)))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate operation")
}

func TestNew_WithNoTemplatesIsAnEmptyCatalog(t *testing.T) {
	e, err := policy.New(policy.WithTemplates())
	require.NoError(t, err)
	assert.Empty(t, e.Operations())
}

func TestEngine_TemplateReturnsACopy(t *testing.T) {
	e := testEngine(t)
	tpl, err := e.Template("test.op")
	require.NoError(t, err)
	*tpl.Config["min"].Maximum = 1000
	tpl.Config["max"] = policy.Setting{Type: policy.SettingTypeInteger}

	_, err = e.Bind(t.Context(), "test.op", &policy.Instance{Kind: policy.KindPolicy, Operation: "test.op", Config: map[string]any{"min": 11}})
	require.ErrorIs(t, err, policy.ErrInvalidInstance, "the engine must still apply its own bounds")
}

func TestEngine_UnknownOperation(t *testing.T) {
	e := testEngine(t)

	_, err := e.Bind(t.Context(), "nope", nil)
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
	_, err = e.Template("nope")
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
	err = e.ValidateInstance(t.Context(), &policy.Instance{Kind: policy.KindPolicy, Operation: "nope"})
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
}

func TestBind_InstanceForAnotherOperation(t *testing.T) {
	e := testEngine(t)
	_, err := e.Bind(t.Context(), "test.op", &policy.Instance{Kind: policy.KindPolicy, Operation: "other.op"})
	require.ErrorIs(t, err, policy.ErrInvalidInstance)
}

func TestValidateInstance_Nil(t *testing.T) {
	require.ErrorIs(t, testEngine(t).ValidateInstance(t.Context(), nil), policy.ErrInvalidInstance)
}

func TestBind_NilConfigIsNotEmpty(t *testing.T) {
	_, err := testEngine(t).Bind(t.Context(), "test.op", &policy.Instance{Kind: policy.KindPolicy, Operation: "test.op"})
	require.ErrorIs(t, err, policy.ErrInvalidInstance)
}

func TestBound_Evaluate_RuntimeCostLimit(t *testing.T) {
	// The estimate assumes lists of 2, so the rule compiles; a request with
	// a long list then runs past the runtime budget and fails, never allows.
	e, err := policy.New(
		policy.WithTemplates(mustTemplate(t, testTemplate)),
		policy.WithLimits(policy.Limits{MaxExpressionLength: 256, MaxEstimatedCost: 1_000, MaxRuntimeCost: 50, MaxListSize: 2}),
	)
	require.NoError(t, err)
	b := bindTest(t, e, map[string]any{"max": 5})

	_, err = b.Evaluate(t.Context(), map[string]any{"value": 3, "counts": make([]int64, 1_000)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cost limit")
}

// One bound policy serves every request that runs the operation, so Evaluate
// runs concurrently on it. Each goroutine checks its own decision, so a
// shared evaluation state would show as a wrong answer; run with -race to
// catch the data race itself.
func TestBound_Evaluate_Concurrent(t *testing.T) {
	b := bindTest(t, testEngine(t), map[string]any{"min": 2, "max": 5})
	var wg sync.WaitGroup
	for i := range 64 {
		wg.Go(func() {
			value := int64(i % 8)
			for range 50 {
				decision, err := b.Evaluate(t.Context(), map[string]any{
					"value":  value,
					"flags":  []bool{},
					"counts": []int64{value},
				})
				if !assert.NoError(t, err) {
					return
				}
				if !assert.Equal(t, value >= 2 && value <= 5, decision.Allow, "value %d", value) {
					return
				}
			}
		})
	}
	wg.Wait()
}

func TestBound_Evaluate_StopsOnCancelledContext(t *testing.T) {
	b := bindTest(t, testEngine(t), map[string]any{"max": 5})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	_, err := b.Evaluate(ctx, map[string]any{"value": 3, "counts": make([]int64, 1_000)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "context canceled")
}

func TestBind_WrongKind(t *testing.T) {
	e := testEngine(t)
	for _, kind := range []string{"", "branding"} {
		_, err := e.Bind(t.Context(), "test.op", &policy.Instance{Kind: kind, Operation: "test.op"})
		require.ErrorIs(t, err, policy.ErrInvalidInstance, "kind %q", kind)
	}
}

func mustActive(t *testing.T, b *policy.Bound, rule string) bool {
	t.Helper()
	active, err := b.Active(rule)
	require.NoError(t, err)
	return active
}

func TestBound_Evaluate_TypedNilListIsEmpty(t *testing.T) {
	b := bindTest(t, testEngine(t), map[string]any{"max": 5})
	for name, counts := range map[string]any{"[]int64(nil)": []int64(nil), "[]any(nil)": []any(nil)} {
		t.Run(name, func(t *testing.T) {
			d, err := b.Evaluate(t.Context(), map[string]any{"value": 3, "counts": counts})
			require.NoError(t, err)
			assert.True(t, d.Allow)
		})
	}
}

func TestBind_ReportsSettingAndConfigRuleProblemsTogether(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)
	err = e.ValidateInstance(t.Context(), &policy.Instance{
		Kind: policy.KindPolicy, Operation: "auth.factor.password.set",
		Config: map[string]any{"min_length": 20, "max_length": 10, "history_depth": 9},
	})
	require.ErrorIs(t, err, policy.ErrInvalidInstance)
	assert.ErrorContains(t, err, `"history_depth"`)
	assert.ErrorContains(t, err, "min_length_not_above_max_length")
}

func TestBound_UnboundFailsClosed(t *testing.T) {
	var zero policy.Bound
	_, err := zero.Evaluate(t.Context(), nil)
	require.ErrorIs(t, err, policy.ErrUnbound)
	_, err = zero.Constraints()
	require.ErrorIs(t, err, policy.ErrUnbound)
	_, err = zero.Active("min")
	require.ErrorIs(t, err, policy.ErrUnbound)
	assert.Empty(t, zero.Operation())

	var none *policy.Bound
	_, err = none.Evaluate(t.Context(), nil)
	require.ErrorIs(t, err, policy.ErrUnbound)
}

func TestBound_ActiveAndOnlyActiveFieldsRequired(t *testing.T) {
	e := testEngine(t)
	b := bindTest(t, e, map[string]any{"min": 2})
	assert.True(t, mustActive(t, b, "min"))
	assert.False(t, mustActive(t, b, "max"))
	_, err := b.Active("mni")
	require.ErrorIs(t, err, policy.ErrUnknownRule, "a misspelled rule is an error, not off")

	// Only `min` is active and it reads only `value`; `flags` and `counts`
	// may be left out.
	d, err := b.Evaluate(t.Context(), map[string]any{"value": 3})
	require.NoError(t, err)
	assert.True(t, d.Allow)
}

func TestBound_Evaluate_ContextMismatchFailsClosed(t *testing.T) {
	e := testEngine(t)
	b := bindTest(t, e, map[string]any{"min": 2, "max": 9})

	tests := []struct {
		name    string
		context map[string]any
	}{
		{"missing field", map[string]any{"counts": []int64{}}},
		{"wrong type", map[string]any{"value": "3", "counts": []int64{}}},
		{"wrong list element", map[string]any{"value": 3, "counts": []any{"x"}}},
		{"untyped nil list", map[string]any{"value": 3, "counts": nil}},
		{"int beyond int64", map[string]any{"value": math.Pow(2, 63), "counts": []int64{}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := b.Evaluate(t.Context(), tt.context)
			require.ErrorIs(t, err, policy.ErrContextMismatch)
		})
	}
}

func TestBound_Evaluate_NamesTheBrokenPath(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)
	b, err := e.Bind(t.Context(), "auth.factor.password.set", &policy.Instance{Kind: policy.KindPolicy, Operation: "auth.factor.password.set", Config: map[string]any{"min_length": 3}})
	require.NoError(t, err)

	_, err = b.Evaluate(t.Context(), map[string]any{"candidate": map[string]int{"length": 9}})
	require.ErrorIs(t, err, policy.ErrContextMismatch)
	assert.ErrorContains(t, err, `field "candidate" is not an object`)

	_, err = b.Evaluate(t.Context(), map[string]any{})
	assert.ErrorContains(t, err, `missing field "candidate"`)
}

func TestBound_Evaluate_ListOfIntShapes(t *testing.T) {
	e := testEngine(t)
	b := bindTest(t, e, map[string]any{"max": 5})

	for name, counts := range map[string]any{
		"[]int64":      []int64{1, 5},
		"[]int":        []int{1, 5},
		"json-decoded": []any{float64(1), float64(5)},
	} {
		t.Run(name, func(t *testing.T) {
			d, err := b.Evaluate(t.Context(), map[string]any{"value": 3, "counts": counts})
			require.NoError(t, err)
			assert.True(t, d.Allow)
		})
	}
}

func TestParseInstance(t *testing.T) {
	inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"test.op","config":{"min":3}}`))
	require.NoError(t, err)
	assert.Equal(t, "test.op", inst.Operation)

	withSchema, err := policy.ParseInstance([]byte(`{"$schema":"../meta/policy.json","kind":"policy","operation":"test.op","config":{}}`))
	require.NoError(t, err, "an authored file carries an editor $schema pointer")
	out, err := json.Marshal(withSchema)
	require.NoError(t, err)
	assert.NotContains(t, string(out), "$schema", "the editor pointer must not travel with the instance")

	decimal, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"test.op","config":{"min":2.0,"max":1e1}}`))
	require.NoError(t, err)
	require.NoError(t, testEngine(t).ValidateInstance(t.Context(), decimal), "2.0 and 1e1 are integers")

	for name, config := range map[string]string{
		"fraction just below the minimum":      `{"min":0.99999999999999999}`,
		"fraction just above the maximum":      `{"max":10.0000000000000001}`,
		"integer beyond float64's exact range": `{"min":9007199254740993}`,
		"integer beyond int64":                 `{"min":9223372036854775808}`,
		"exponent form beyond int64":           `{"min":1e19}`,
		"huge exponent":                        `{"min":1e999999}`,
		"long digit run":                       `{"min":` + strings.Repeat("1", 40) + `.0}`,
	} {
		t.Run(name, func(t *testing.T) {
			inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"test.op","config":` + config + `}`))
			require.NoError(t, err)
			require.ErrorIs(t, testEngine(t).ValidateInstance(t.Context(), inst), policy.ErrInvalidInstance)
		})
	}

	for name, doc := range map[string]string{
		"unknown field":           `{"kind":"policy","operation":"test.op","config":{},"audience":{}}`,
		"wrong kind":              `{"kind":"branding","operation":"test.op","config":{}}`,
		"missing operation":       `{"kind":"policy","config":{}}`,
		"not json":                `{`,
		"trailing data":           `{"kind":"policy","operation":"test.op","config":{}} {"config":{"min":1}}`,
		"duplicate setting":       `{"kind":"policy","operation":"test.op","config":{"min":5,"min":2}}`,
		"duplicate envelope":      `{"kind":"policy","operation":"test.op","operation":"other.op","config":{}}`,
		"case variant of a field": `{"kind":"policy","operation":"test.op","config":{"min":5},"Config":{}}`,
		"field in another case":   `{"KIND":"policy","operation":"test.op","config":{}}`,
		"missing config":          `{"kind":"policy","operation":"test.op"}`,
		"null config":             `{"kind":"policy","operation":"test.op","config":null}`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := policy.ParseInstance([]byte(doc))
			require.ErrorIs(t, err, policy.ErrInvalidInstance)
		})
	}
}
