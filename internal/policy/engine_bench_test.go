package policy_test

import (
	"reflect"
	"testing"

	"github.com/zitadel/nextgen/internal/policy"
)

// The Go twin of the user.password.save template: the same three rules,
// hand-written, with the same output shape (every violated rule, no
// short-circuit), so the benchmark compares the evaluator, not the work.
type goViolation struct {
	Rule   string
	Config map[string]any
}

func evaluateGo(minLength, maxLength, historyDepth int64, candidateLength int64, historyMatches []bool) (bool, []goViolation) {
	var violations []goViolation
	if candidateLength < minLength {
		violations = append(violations, goViolation{Rule: "min_length", Config: map[string]any{"min_length": minLength}})
	}
	if candidateLength > maxLength {
		violations = append(violations, goViolation{Rule: "max_length", Config: map[string]any{"max_length": maxLength}})
	}
	if historyDepth != 0 {
		for _, m := range historyMatches {
			if m {
				violations = append(violations, goViolation{Rule: "history", Config: map[string]any{"history_depth": historyDepth}})
				break
			}
		}
	}
	return len(violations) == 0, violations
}

type benchCase struct {
	name    string
	length  int64
	history []bool
	allow   bool
}

var benchCases = []benchCase{
	{"allow", 20, []bool{false, false, false, false}, true},
	{"deny_two_rules", 10, []bool{false, true, false, false}, false},
}

func benchInstance(tb testing.TB) (*policy.Engine, *policy.Instance) {
	tb.Helper()
	e, err := policy.New()
	if err != nil {
		tb.Fatal(err)
	}
	inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"user.password.save","config":{"min_length":15,"history_depth":4}}`))
	if err != nil {
		tb.Fatal(err)
	}
	return e, inst
}

func requestContext(c benchCase) map[string]any {
	return map[string]any{
		"candidate":       map[string]any{"length": c.length},
		"history_matches": c.history,
	}
}

// The Go twin must agree with the engine on every case before either is
// timed: same decision, same violations in rule order, same echoed settings.
func TestBenchmarkTwinsAgree(t *testing.T) {
	t.Parallel()
	e, inst := benchInstance(t)
	for _, c := range benchCases {
		decision, err := e.Evaluate(t.Context(), inst, requestContext(c))
		if err != nil {
			t.Fatal(err)
		}
		allow, violations := evaluateGo(15, 64, 4, c.length, c.history)
		if decision.Allow != c.allow || allow != c.allow {
			t.Fatalf("%s: CEL allow=%v, Go allow=%v, want %v", c.name, decision.Allow, allow, c.allow)
		}
		if len(decision.Violations) != len(violations) {
			t.Fatalf("%s: CEL %+v, Go %+v", c.name, decision.Violations, violations)
		}
		for i := range violations {
			if decision.Violations[i].Rule != violations[i].Rule || !reflect.DeepEqual(decision.Violations[i].Config, violations[i].Config) {
				t.Fatalf("%s: violation %d: CEL %+v, Go %+v", c.name, i, decision.Violations[i], violations[i])
			}
		}
	}
}

func BenchmarkEvaluateCEL(b *testing.B) {
	e, inst := benchInstance(b)
	for _, c := range benchCases {
		b.Run(c.name, func(b *testing.B) {
			ctx := b.Context()
			rc := requestContext(c)
			b.ReportAllocs()
			for b.Loop() {
				decision, err := e.Evaluate(ctx, inst, rc)
				if err != nil {
					b.Fatal(err)
				}
				if decision.Allow != c.allow {
					b.Fatalf("unexpected decision %+v", decision)
				}
			}
		})
	}
}

func BenchmarkEvaluateGo(b *testing.B) {
	for _, c := range benchCases {
		b.Run(c.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				allow, _ := evaluateGo(15, 64, 4, c.length, c.history)
				if allow != c.allow {
					b.Fatalf("unexpected decision")
				}
			}
		})
	}
}
