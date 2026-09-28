package policy_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/policy"
)

func TestStaticResolver(t *testing.T) {
	e := mustEngine(t)
	first := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":12}}`)
	newest := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":20}}`)
	r := policy.NewStaticResolver()
	r.Add("proj", first, newest)

	tests := []struct {
		name    string
		project string
		wantMin int64
	}{
		{"newest instance for the operation wins", "proj", 20},
		{"unknown project falls back to template defaults", "elsewhere", 15},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inst, err := policy.Effective(t.Context(), e, r, tt.project, "user.password.save")
			if err != nil {
				t.Fatal(err)
			}
			c, err := e.Constraints(inst)
			if err != nil {
				t.Fatal(err)
			}
			if got := c.Rules["min_length"]["min_length"]; got != tt.wantMin {
				t.Fatalf("min_length = %v, want %d", got, tt.wantMin)
			}
		})
	}
}

func TestEffectiveWithoutResolver(t *testing.T) {
	e := mustEngine(t)
	inst, err := policy.Effective(t.Context(), e, nil, "proj", "user.password.save")
	if err != nil {
		t.Fatal(err)
	}
	c, _ := e.Constraints(inst)
	if c.Rules["min_length"]["min_length"] != int64(15) {
		t.Fatalf("expected template default 15, got %v", c.Rules["min_length"]["min_length"])
	}
}
