package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

// builtinChallenge is the user.create gate of a project without a policy:
// the guard's built-in proof of work. It never reads storage.
func builtinChallenge(t testing.TB) *service.UserCreatePolicy {
	t.Helper()
	return newUserCreateGate(t, mustPolicyEngine(t), service.NoPolicyResolver{})
}

func newUserCreateGate(t testing.TB, engine *policy.Engine, resolver service.PolicyResolver) *service.UserCreatePolicy {
	t.Helper()
	gate, err := service.NewUserCreatePolicy(engine, resolver)
	require.NoError(t, err)
	return gate
}

// userCreatePolicy resolves the same user.create instance for every project.
type userCreatePolicy struct{ config map[string]any }

func (f userCreatePolicy) ResolvePolicy(_ context.Context, _ string, operation string) (*policy.Instance, error) {
	return &policy.Instance{Kind: policy.KindPolicy, Operation: operation, Config: f.config}, nil
}

// twoChallenges is the catalog a second challenge provider will bring: the
// user.create template with a challenge the server cannot issue yet, so the
// paths that refuse the built-in one can be tested before it exists.
func twoChallenges(t testing.TB) *policy.Engine {
	t.Helper()
	tpl, err := policy.ParseTemplate([]byte(`{
  "operation": "user.create",
  "config": { "challenge": { "type": "string", "enum": ["zitadel_pow", "turnstile"] } },
  "context": { "solved_challenge": "string" },
  "rules": [ { "name": "challenge", "expression": "solved_challenge == config.challenge" } ]
}`))
	require.NoError(t, err)
	engine, err := policy.New(policy.WithTemplates(tpl))
	require.NoError(t, err)
	return engine
}

func TestNewUserCreatePolicy_RequiresTheOperationTemplate(t *testing.T) {
	empty, err := policy.New(policy.WithTemplates())
	require.NoError(t, err)
	_, err = service.NewUserCreatePolicy(empty, service.NoPolicyResolver{})
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
}

func TestUserCreatePolicy_Challenge(t *testing.T) {
	ctx := t.Context()
	for name, resolver := range map[string]service.PolicyResolver{
		"no policy":                  service.NoPolicyResolver{},
		"a policy that sets nothing": userCreatePolicy{config: map[string]any{}},
		"the default policy":         userCreatePolicy{config: map[string]any{"challenge": domain.SignupGateProvider}},
	} {
		t.Run(name, func(t *testing.T) {
			challenge, err := newUserCreateGate(t, mustPolicyEngine(t), resolver).Challenge(ctx, "project")
			require.NoError(t, err)
			assert.Equal(t, domain.SignupGateProvider, challenge)
		})
	}

	challenge, err := newUserCreateGate(t, twoChallenges(t), userCreatePolicy{config: map[string]any{"challenge": "turnstile"}}).Challenge(ctx, "project")
	require.NoError(t, err)
	assert.Equal(t, "turnstile", challenge, "the policy names the challenge")
}

// A policy that cannot be read or bound fails the sign-up closed: it is
// never read as "no policy", which would only fall back to the guard today
// but would drop a stronger challenge once there is one.
func TestUserCreatePolicy_FailsClosed(t *testing.T) {
	ctx := t.Context()
	for name, resolver := range map[string]service.PolicyResolver{
		"the policy cannot be read":                        failingPolicy{},
		"a stored challenge the template no longer admits": userCreatePolicy{config: map[string]any{"challenge": "turnstile"}},
	} {
		t.Run(name, func(t *testing.T) {
			gate := newUserCreateGate(t, mustPolicyEngine(t), resolver)
			_, err := gate.Challenge(ctx, "project")
			require.ErrorIs(t, err, domain.ErrInternal(nil))
			err = gate.CheckSolved(ctx, "project", domain.SignupGateProvider)
			require.ErrorIs(t, err, domain.ErrInternal(nil))
		})
	}
}

func TestUserCreatePolicy_CheckSolved(t *testing.T) {
	ctx := t.Context()
	require.NoError(t, builtinChallenge(t).CheckSolved(ctx, "project", domain.SignupGateProvider))

	gate := newUserCreateGate(t, twoChallenges(t), userCreatePolicy{config: map[string]any{"challenge": "turnstile"}})
	require.NoError(t, gate.CheckSolved(ctx, "project", "turnstile"))
	err := gate.CheckSolved(ctx, "project", domain.SignupGateProvider)
	require.ErrorIs(t, err, domain.ErrFlowProofInvalid(), "a proof of work where the policy names another challenge")
}

// A challenge the server cannot issue is a server fault before anything is
// read, locked or spent, never a sign-up without a challenge.
func TestSignupChallengeTheServerCannotIssue(t *testing.T) {
	ctrl := gomock.NewController(t)
	// Any read, lock or budget write fails the test.
	gate := newUserCreateGate(t, twoChallenges(t), userCreatePolicy{config: map[string]any{"challenge": "turnstile"}})
	svc := service.NewSignupProtection(servicemocks.NewMockPool(ctrl), nil, gate)
	_, err := svc.Challenge(t.Context(), &domain.FlowState{ProjectID: "project", ID: "flow"})
	require.ErrorIs(t, err, domain.ErrInternal(nil))
}

func TestSignupChallengeFailsClosedOnAnUnreadablePolicy(t *testing.T) {
	ctrl := gomock.NewController(t)
	svc := service.NewSignupProtection(servicemocks.NewMockPool(ctrl), nil, newUserCreateGate(t, mustPolicyEngine(t), failingPolicy{}))
	_, err := svc.Challenge(t.Context(), &domain.FlowState{ProjectID: "project", ID: "flow"})
	require.ErrorIs(t, err, domain.ErrInternal(nil))
}
