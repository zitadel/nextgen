package policy_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/policy"
)

func TestStaticResolverAudience(t *testing.T) {
	e := mustEngine(t)
	projectDefault := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":15}}`)
	acme := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","audience":{"team_ids":["team_acme"]},"config":{"min_length":20}}`)
	r := policy.NewStaticResolver()
	r.Add("proj", projectDefault, acme)

	tests := []struct {
		name    string
		project string
		hint    policy.Hint
		wantMin int64
	}{
		{"team match wins", "proj", policy.Hint{TeamID: "team_acme"}, 20},
		{"other team gets the default", "proj", policy.Hint{TeamID: "team_other"}, 15},
		{"no hint gets the default", "proj", policy.Hint{}, 15},
		{"unknown project falls back to template defaults", "elsewhere", policy.Hint{TeamID: "team_acme"}, 15},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inst, err := policy.Effective(t.Context(), e, r, tt.project, "user.password.save", tt.hint)
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

func TestScopedInstanceNeverAppliesOutsideAudience(t *testing.T) {
	e := mustEngine(t)
	acme := passwordInstance(t, `{"kind":"policy","operation":"user.password.save","audience":{"team_ids":["team_acme"]},"config":{"min_length":20}}`)
	r := policy.NewStaticResolver()
	r.Add("proj", acme)
	inst, err := policy.Effective(t.Context(), e, r, "proj", "user.password.save", policy.Hint{TeamID: "team_other"})
	if err != nil {
		t.Fatal(err)
	}
	if !inst.Audience.IsEmpty() {
		t.Fatalf("resolved a scoped instance outside its audience: %+v", inst)
	}
	c, _ := e.Constraints(inst)
	if c.Rules["min_length"]["min_length"] != int64(15) {
		t.Fatalf("expected template default 15, got %v", c.Rules["min_length"]["min_length"])
	}
}
