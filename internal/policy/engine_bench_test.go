package policy_test

import (
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
}

var benchCases = []benchCase{
	{"allow", 20, []bool{false, false, false, false}},
	{"deny_two_rules", 10, []bool{false, true, false, false}},
}

func BenchmarkEvaluateCEL(b *testing.B) {
	e, err := policy.New()
	if err != nil {
		b.Fatal(err)
	}
	inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"user.password.save","config":{"min_length":15,"history_depth":4}}`))
	if err != nil {
		b.Fatal(err)
	}
	for _, c := range benchCases {
		b.Run(c.name, func(b *testing.B) {
			ctx := b.Context()
			requestContext := map[string]any{
				"candidate":       map[string]any{"length": c.length},
				"history_matches": c.history,
			}
			b.ReportAllocs()
			for b.Loop() {
				decision, err := e.Evaluate(ctx, inst, requestContext)
				if err != nil {
					b.Fatal(err)
				}
				if decision.Allow != (c.name == "allow") {
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
				if allow != (c.name == "allow") {
					b.Fatalf("unexpected decision")
				}
			}
		})
	}
}
