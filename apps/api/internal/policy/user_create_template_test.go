package policy_test

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

const userCreate = "user.create"

// The guard's built-in challenge must stay a value the policy can name: the
// default policy names it, and so does every project that keeps the default.
func TestUserCreateTemplate_OffersTheGuardsChallenge(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)
	tpl, err := e.Template(userCreate)
	require.NoError(t, err)
	assert.Contains(t, tpl.Config["challenge"].Enum, domain.SignupGateProvider)
}

// The default policy writes down the guards and nothing else (ADR 088 §5):
// deploying it changes nothing, and deleting it loosens nothing, because the
// guard applies without it. A setting only the default held would be lost
// with the file, so a stronger free baseline is a stronger guard, not a
// stronger default.
func TestDefaultUserCreatePolicy_EqualsTheGuard(t *testing.T) {
	var file struct {
		Operation string         `json:"operation"`
		Config    map[string]any `json:"config"`
	}
	dec := json.NewDecoder(bytes.NewReader(configdefaults.DefaultUserCreatePolicy()))
	dec.DisallowUnknownFields()
	require.NoError(t, dec.Decode(&file))

	assert.Equal(t, userCreate, file.Operation)
	assert.Equal(t, map[string]any{"challenge": domain.SignupGateProvider}, file.Config)

	e, err := policy.New()
	require.NoError(t, err)
	require.NoError(t, e.ValidateInstance(t.Context(), &policy.Instance{Kind: policy.KindPolicy, Operation: file.Operation, Config: file.Config}))
}

func TestUserCreate_Evaluate(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)

	tests := []struct {
		name           string
		config         string // nil instance when empty
		context        map[string]any
		wantViolations map[string]any
	}{
		{
			name: "no instance enforces nothing and needs no context",
		},
		{
			name:   "empty config enforces nothing",
			config: `{}`,
		},
		{
			name:    "the challenge the policy names, solved",
			config:  `{"challenge":"zitadel_pow"}`,
			context: map[string]any{"solved_challenge": "zitadel_pow"},
		},
		{
			name:           "another challenge than the one the policy names",
			config:         `{"challenge":"zitadel_pow"}`,
			context:        map[string]any{"solved_challenge": "turnstile"},
			wantViolations: map[string]any{"challenge": "zitadel_pow"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var inst *policy.Instance
			if tt.config != "" {
				inst, err = policy.ParseInstance([]byte(`{"kind":"policy","operation":"user.create","config":` + tt.config + `}`))
				require.NoError(t, err)
			}
			b, err := e.Bind(t.Context(), userCreate, inst)
			require.NoError(t, err)
			d, err := b.Evaluate(t.Context(), tt.context)
			require.NoError(t, err)
			assert.Equal(t, tt.wantViolations == nil, d.Allow)
			assert.Equal(t, tt.wantViolations, d.Violations)
		})
	}
}

func TestUserCreate_RejectsAChallengeTheServerCannotIssue(t *testing.T) {
	e, err := policy.New()
	require.NoError(t, err)
	inst, err := policy.ParseInstance([]byte(`{"kind":"policy","operation":"user.create","config":{"challenge":"turnstile"}}`))
	require.NoError(t, err)
	err = e.ValidateInstance(t.Context(), inst)
	require.ErrorIs(t, err, policy.ErrInvalidInstance)
	assert.ErrorContains(t, err, `"turnstile" is not one of [zitadel_pow]`)
}
