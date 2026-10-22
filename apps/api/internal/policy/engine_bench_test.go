package policy_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/policy"
)

// The benchmarks below measure what evaluating the password policy through
// CEL costs next to the same three checks written in Go (#1437). The
// instance is bound once, as the gate does per resolve; each iteration is
// one password save's evaluation, without building the context and without
// any hashing.

var benchContext = map[string]any{
	"candidate":       map[string]any{"length": 14},
	"self_service":    true,
	"history_matches": []bool{false, false, true, false},
}

func BenchmarkEvaluate_CEL(b *testing.B) {
	e, err := policy.New()
	if err != nil {
		b.Fatal(err)
	}
	inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"auth.factor.password.set","config":{"min_length":15,"max_length":64,"history_depth":4}}`))
	if err != nil {
		b.Fatal(err)
	}
	bound, err := e.Bind(b.Context(), "auth.factor.password.set", inst)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		d, err := bound.Evaluate(b.Context(), benchContext)
		if err != nil || d.Allow {
			b.Fatalf("want a deny, got %+v, %v", d, err)
		}
	}
}

// passwordRulesGo is the hand-written twin of the template's rules.
func passwordRulesGo(minLength, maxLength, historyDepth int, length int, selfService bool, historyMatches []bool) map[string]any {
	var violations map[string]any
	add := func(rule string, value int) {
		if violations == nil {
			violations = make(map[string]any, 3)
		}
		violations[rule] = int64(value)
	}
	if length < minLength {
		add("min_length", minLength)
	}
	if length > maxLength {
		add("max_length", maxLength)
	}
	for _, matched := range historyMatches[:min(len(historyMatches), historyDepth)] {
		if !selfService {
			break
		}
		if matched {
			add("history_depth", historyDepth)
			break
		}
	}
	return violations
}

func BenchmarkEvaluate_Go(b *testing.B) {
	matches := benchContext["history_matches"].([]bool)
	b.ReportAllocs()
	for b.Loop() {
		if v := passwordRulesGo(15, 64, 4, 14, true, matches); len(v) == 0 {
			b.Fatal("want a deny")
		}
	}
}
