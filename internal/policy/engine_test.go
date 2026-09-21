package policy_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/internal/policy"
)

func mustEngine(t *testing.T, opts ...policy.Option) *policy.Engine {
	t.Helper()
	e, err := policy.New(opts...)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return e
}

func passwordInstance(t *testing.T, doc string) *policy.Instance {
	t.Helper()
	inst, err := policy.ParseInstance([]byte(doc))
	if err != nil {
		t.Fatalf("ParseInstance: %v", err)
	}
	return inst
}

func TestEmbeddedCatalogCompiles(t *testing.T) {
	e := mustEngine(t)
	ops := e.Operations()
	if len(ops) != 1 || ops[0] != "user.password.save" {
		t.Fatalf("operations = %v, want [user.password.save]", ops)
	}
}

func TestEvaluatePasswordSave(t *testing.T) {
	e := mustEngine(t)
	inst := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":15,"history_depth":4}}`)

	tests := []struct {
		name      string
		context   map[string]any
		wantAllow bool
		wantRules []string
	}{
		{
			name:      "long enough, no history match",
			context:   map[string]any{"candidate": map[string]any{"length": 15}, "history_matches": []bool{false, false}},
			wantAllow: true,
		},
		{
			name:      "too short",
			context:   map[string]any{"candidate": map[string]any{"length": 14}, "history_matches": []bool{}},
			wantRules: []string{"min_length"},
		},
		{
			name:      "matches a previous password",
			context:   map[string]any{"candidate": map[string]any{"length": 20}, "history_matches": []bool{false, true}},
			wantRules: []string{"history"},
		},
		{
			name:      "every rule reports, no short-circuit",
			context:   map[string]any{"candidate": map[string]any{"length": 3}, "history_matches": []bool{true}},
			wantRules: []string{"min_length", "history"},
		},
		{
			name:      "json-decoded numbers are accepted",
			context:   map[string]any{"candidate": map[string]any{"length": float64(16)}, "history_matches": []any{false}},
			wantAllow: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, err := e.Evaluate(t.Context(), inst, tt.context)
			if err != nil {
				t.Fatalf("Evaluate: %v", err)
			}
			if d.Allow != tt.wantAllow {
				t.Fatalf("allow = %v, want %v (violations %+v)", d.Allow, tt.wantAllow, d.Violations)
			}
			var got []string
			for _, v := range d.Violations {
				got = append(got, v.Rule)
			}
			if strings.Join(got, ",") != strings.Join(tt.wantRules, ",") {
				t.Fatalf("violations = %v, want %v", got, tt.wantRules)
			}
		})
	}
}

func TestViolationEchoesPublicSettings(t *testing.T) {
	e := mustEngine(t)
	inst := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":20}}`)
	d, err := e.Evaluate(t.Context(), inst, map[string]any{"candidate": map[string]any{"length": 5}, "history_matches": []bool{}})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Violations) != 1 || d.Violations[0].Rule != "min_length" {
		t.Fatalf("violations = %+v", d.Violations)
	}
	if got := d.Violations[0].Config["min_length"]; got != int64(20) {
		t.Fatalf("echoed min_length = %v (%T), want 20", got, got)
	}
}

func TestDefaultsFillMissingSettings(t *testing.T) {
	e := mustEngine(t)
	inst := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{}}`)
	c, err := e.Constraints(inst)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.Rules["min_length"]["min_length"]; got != int64(15) {
		t.Fatalf("default min_length = %v, want 15", got)
	}
	if got := c.Rules["history"]["history_depth"]; got != int64(0) {
		t.Fatalf("default history_depth = %v, want 0", got)
	}
}

func TestConstraintsListsEveryRule(t *testing.T) {
	e := mustEngine(t)
	inst, err := e.DefaultInstance("user.password.save")
	if err != nil {
		t.Fatal(err)
	}
	c, err := e.Constraints(inst)
	if err != nil {
		t.Fatal(err)
	}
	tmpl, _ := e.Template("user.password.save")
	for _, rule := range tmpl.Rules {
		if _, ok := c.Rules[rule.Name]; !ok {
			t.Fatalf("rule %q missing from constraints %+v", rule.Name, c.Rules)
		}
	}
	out, _ := json.Marshal(c)
	want := `{"operation":"user.password.save","rules":{"history":{"history_depth":0},"max_length":{"max_length":64},"min_length":{"min_length":15}}}`
	if string(out) != want {
		t.Fatalf("constraints json = %s\nwant %s", out, want)
	}
}

func TestValidateInstance(t *testing.T) {
	e := mustEngine(t)
	tests := []struct {
		name    string
		doc     string
		wantErr string
	}{
		{"valid", `{"kind":"policy","operation":"user.password.save","config":{"min_length":12}}`, ""},
		{"audit mode", `{"kind":"policy","operation":"user.password.save","enforcement":"audit","config":{}}`, ""},
		{"unknown operation", `{"kind":"policy","operation":"user.nope","config":{}}`, "unknown operation"},
		{"unknown setting", `{"kind":"policy","operation":"user.password.save","config":{"pattern":"x"}}`, `"pattern" is not defined`},
		{"below floor", `{"kind":"policy","operation":"user.password.save","config":{"min_length":4}}`, "below the minimum 8"},
		{"above ceiling", `{"kind":"policy","operation":"user.password.save","config":{"history_depth":5}}`, "above the maximum 4"},
		{"wrong type", `{"kind":"policy","operation":"user.password.save","config":{"min_length":"12"}}`, "expected an integer"},
		{"fractional", `{"kind":"policy","operation":"user.password.save","config":{"min_length":12.5}}`, "expected an integer"},
		{"bad enforcement", `{"kind":"policy","operation":"user.password.save","enforcement":"warn","config":{}}`, "enforcement must be"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inst := passwordInstance(t, tt.doc)
			err := e.ValidateInstance(inst)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestContextMismatchFailsClosed(t *testing.T) {
	e := mustEngine(t)
	inst, _ := e.DefaultInstance("user.password.save")
	tests := []struct {
		name    string
		context map[string]any
	}{
		{"missing field", map[string]any{"candidate": map[string]any{}, "history_matches": []bool{}}},
		{"wrong type", map[string]any{"candidate": map[string]any{"length": "12"}, "history_matches": []bool{}}},
		{"wrong list element", map[string]any{"candidate": map[string]any{"length": 12}, "history_matches": []any{"yes"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := e.Evaluate(t.Context(), inst, tt.context)
			if !errors.Is(err, policy.ErrContextMismatch) {
				t.Fatalf("error = %v, want ErrContextMismatch", err)
			}
		})
	}
}

func TestEnforcementAuditDoesNotBlock(t *testing.T) {
	enforce := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{}}`)
	audit := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","enforcement":"audit","config":{}}`)
	if !enforce.Blocks() {
		t.Fatal("default enforcement should block")
	}
	if audit.Blocks() {
		t.Fatal("audit enforcement should not block")
	}
}

func templateWith(t *testing.T, rules ...policy.Rule) *policy.Template {
	t.Helper()
	return &policy.Template{
		Operation: "test.op",
		Config: map[string]policy.Setting{
			"limit":        {Type: policy.SettingTypeInteger, Default: 1, Public: true},
			"secret_limit": {Type: policy.SettingTypeInteger, Default: 10},
		},
		Context: policy.ContextSchema{
			"n":     "int",
			"items": "list<string>",
		},
		Rules: rules,
	}
}

func TestCompileRejects(t *testing.T) {
	tests := []struct {
		name    string
		rule    policy.Rule
		limits  policy.Limits
		wantErr string
	}{
		{"unknown context field", policy.Rule{Name: "r", Expression: "candidate.length > 1"}, policy.DefaultLimits, "undeclared reference"},
		{"unknown setting", policy.Rule{Name: "r", Expression: "n > config.nope"}, policy.DefaultLimits, "undeclared reference"},
		{"not bool", policy.Rule{Name: "r", Expression: "n + 1"}, policy.DefaultLimits, "must evaluate to bool"},
		{"type error", policy.Rule{Name: "r", Expression: "n == 'x'"}, policy.DefaultLimits, "no matching overload"},
		{"too long", policy.Rule{Name: "r", Expression: "n > 1 " + strings.Repeat("&& n > 1 ", 40)}, policy.DefaultLimits, "limit is 256"},
		{"too expensive", policy.Rule{Name: "r", Expression: "items.all(a, items.all(b, a != b))"}, policy.Limits{MaxExpressionLength: 256, MaxEstimatedCost: 50, MaxRuntimeCost: 50, MaxListSize: 64}, "estimated cost"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := policy.New(policy.WithTemplates(templateWith(t, tt.rule)), policy.WithLimits(tt.limits))
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestPrivateSettingsNeverEchoed(t *testing.T) {
	e := mustEngine(t, policy.WithTemplates(templateWith(t,
		policy.Rule{Name: "both", Expression: "n >= config.limit && n <= config.secret_limit"},
	)))
	inst := &policy.Instance{Kind: policy.KindPolicy, Operation: "test.op", Config: map[string]any{}}
	c, err := e.Constraints(inst)
	if err != nil {
		t.Fatal(err)
	}
	if _, leaked := c.Rules["both"]["secret_limit"]; leaked {
		t.Fatalf("private setting leaked into constraints: %+v", c.Rules)
	}
	if c.Rules["both"]["limit"] != int64(1) {
		t.Fatalf("public setting missing: %+v", c.Rules)
	}
	d, err := e.Evaluate(t.Context(), inst, map[string]any{"n": 0, "items": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, leaked := d.Violations[0].Config["secret_limit"]; leaked {
		t.Fatalf("private setting leaked into violation: %+v", d.Violations)
	}
}

func TestRuntimeCostLimitAborts(t *testing.T) {
	e := mustEngine(t,
		policy.WithTemplates(templateWith(t, policy.Rule{Name: "r", Expression: "items.all(a, items.exists(b, a == b))"})),
		policy.WithLimits(policy.Limits{MaxExpressionLength: 256, MaxEstimatedCost: 1_000_000, MaxRuntimeCost: 20, MaxListSize: 64}),
	)
	inst := &policy.Instance{Kind: policy.KindPolicy, Operation: "test.op", Config: map[string]any{}}
	items := make([]string, 64)
	for i := range items {
		items[i] = strings.Repeat("x", i)
	}
	_, err := e.Evaluate(t.Context(), inst, map[string]any{"n": 5, "items": items})
	if err == nil || !strings.Contains(err.Error(), "cost limit") {
		t.Fatalf("error = %v, want cost limit exceeded", err)
	}
}

func TestFixedSettingCannotBeSet(t *testing.T) {
	e := mustEngine(t)
	inst := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"max_length":4096}}`)
	err := e.ValidateInstance(inst)
	if err == nil || !strings.Contains(err.Error(), `"max_length" is fixed`) {
		t.Fatalf("error = %v, want fixed-setting rejection", err)
	}
}

func TestFixedSettingIsVisibleInConstraints(t *testing.T) {
	e := mustEngine(t)
	inst, _ := e.DefaultInstance("user.password.save")
	c, err := e.Constraints(inst)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.Rules["max_length"]["max_length"]; got != int64(64) {
		t.Fatalf("max_length constraint = %v, want 64", got)
	}
	d, err := e.Evaluate(t.Context(), inst, map[string]any{"candidate": map[string]any{"length": 65}, "history_matches": []bool{}})
	if err != nil {
		t.Fatal(err)
	}
	if d.Allow || len(d.Violations) != 1 || d.Violations[0].Rule != "max_length" {
		t.Fatalf("decision = %+v, want max_length violation", d)
	}
}

func TestWarningsBelowRecommendedMinimum(t *testing.T) {
	e := mustEngine(t)
	low := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":8}}`)
	w, err := e.Warnings(low)
	if err != nil {
		t.Fatal(err)
	}
	if len(w) != 1 || w[0].Setting != "min_length" || w[0].Value != 8 || w[0].RecommendedMinimum != 15 {
		t.Fatalf("warnings = %+v", w)
	}
	ok := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":15}}`)
	w, err = e.Warnings(ok)
	if err != nil {
		t.Fatal(err)
	}
	if len(w) != 0 {
		t.Fatalf("warnings = %+v, want none", w)
	}
}

func TestAuditNeverWeakensTheBaseline(t *testing.T) {
	e := mustEngine(t)
	audit := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","enforcement":"audit","config":{"min_length":20,"history_depth":2}}`)
	ctx := func(length int, matches ...bool) map[string]any {
		if matches == nil {
			matches = []bool{}
		}
		return map[string]any{"candidate": map[string]any{"length": length}, "history_matches": matches}
	}
	tests := []struct {
		name        string
		context     map[string]any
		wantAllow   bool
		wantBlock   []string
		wantAudited []string
	}{
		{"meets the stricter instance", ctx(20), true, nil, nil},
		{"meets baseline, misses stricter minimum", ctx(15), true, nil, []string{"min_length"}},
		{"below the baseline blocks even in audit", ctx(10), false, []string{"min_length"}, nil},
		{"history is off in the baseline, so a match is only audited", ctx(20, true), true, nil, []string{"history"}},
		{"above the fixed maximum blocks", ctx(65), false, []string{"max_length"}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, err := e.Evaluate(t.Context(), audit, tt.context)
			if err != nil {
				t.Fatal(err)
			}
			if d.Allow != tt.wantAllow {
				t.Fatalf("allow = %v, want %v (%+v)", d.Allow, tt.wantAllow, d)
			}
			if got := ruleNames(d.Violations); strings.Join(got, ",") != strings.Join(tt.wantBlock, ",") {
				t.Fatalf("blocking = %v, want %v", got, tt.wantBlock)
			}
			if got := ruleNames(d.Audited); strings.Join(got, ",") != strings.Join(tt.wantAudited, ",") {
				t.Fatalf("audited = %v, want %v", got, tt.wantAudited)
			}
		})
	}
}

func ruleNames(vs []policy.Violation) []string {
	var out []string
	for _, v := range vs {
		out = append(out, v.Rule)
	}
	return out
}
