package service_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

// newEvaluateService has a pool that fails the test on any use: a dry run
// reads and writes nothing.
func newEvaluateService(t *testing.T) *service.PolicyService {
	t.Helper()
	pool := servicemocks.NewMockPool(gomock.NewController(t))
	return service.NewPolicyService(service.NewPool(pool), mustPolicyEngine(t))
}

func evaluatePassword(config map[string]any, password string, selfService bool, history ...bool) service.EvaluatePolicyInput {
	return service.EvaluatePolicyInput{
		Operation:   service.OperationPasswordSet,
		Config:      config,
		PasswordSet: &service.PasswordSetEvaluation{Password: password, SelfService: selfService, HistoryMatches: history},
	}
}

func TestPolicyService_Evaluate(t *testing.T) {
	ctx := context.Background()
	violation := domain.ErrUserPasswordPolicyViolation(nil).Code
	for name, tc := range map[string]struct {
		in   service.EvaluatePolicyInput
		want service.PolicyDecision
	}{
		"allowed": {
			in:   evaluatePassword(map[string]any{"min_length": int64(12)}, "a-long-enough-one", true),
			want: service.PolicyDecision{Allowed: true},
		},
		"below the minimum": {
			in:   evaluatePassword(map[string]any{"min_length": int64(12)}, "short1", true),
			want: service.PolicyDecision{Code: violation, Violations: map[string]any{"min_length": int64(12)}},
		},
		"code points, not bytes": {
			// 13 code points, 14 bytes: counting bytes would let it through.
			in:   evaluatePassword(map[string]any{"min_length": int64(14)}, "Passwört12345", true),
			want: service.PolicyDecision{Code: violation, Violations: map[string]any{"min_length": int64(14)}},
		},
		"after NFC normalization": {
			// "o" plus a combining diaeresis is one code point once normalized.
			in:   evaluatePassword(map[string]any{"min_length": int64(14)}, "Passwört12345", true),
			want: service.PolicyDecision{Code: violation, Violations: map[string]any{"min_length": int64(14)}},
		},
		"empty is the live guard, whatever the policy": {
			in:   evaluatePassword(map[string]any{}, "", true),
			want: service.PolicyDecision{Code: domain.ErrUserPasswordEmpty().Code},
		},
		"over the server cap without a max_length": {
			in:   evaluatePassword(map[string]any{}, strings.Repeat("a", domain.MaxPasswordLength+1), true),
			want: service.PolicyDecision{Code: violation, Violations: map[string]any{"max_length": int64(domain.MaxPasswordLength)}},
		},
		"a kept password within the depth": {
			in:   evaluatePassword(map[string]any{"history_depth": int64(2)}, "reused", true, false, true),
			want: service.PolicyDecision{Code: violation, Violations: map[string]any{"history_depth": int64(2)}},
		},
		"a match beyond the depth does not count": {
			in:   evaluatePassword(map[string]any{"history_depth": int64(1)}, "reused", true, false, true),
			want: service.PolicyDecision{Allowed: true},
		},
		"an administrator's set skips the history": {
			in:   evaluatePassword(map[string]any{"history_depth": int64(2)}, "reused", false, true),
			want: service.PolicyDecision{Allowed: true},
		},
		"history off ignores the stated matches": {
			in:   evaluatePassword(map[string]any{}, "reused", true, true),
			want: service.PolicyDecision{Allowed: true},
		},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := newEvaluateService(t).Evaluate(ctx, tc.in)
			require.NoError(t, err)
			assert.Equal(t, tc.want, *got)
		})
	}
}

// The config is checked as a publish checks it, so a dry run of an invalid
// config is refused the same way, not evaluated.
func TestPolicyService_EvaluateChecksTheConfigLikeAPublish(t *testing.T) {
	ctx := context.Background()
	for name, in := range map[string]service.EvaluatePolicyInput{
		"settings that contradict each other":   evaluatePassword(map[string]any{"min_length": int64(20), "max_length": int64(10)}, "x", true),
		"a value outside the template's bounds": evaluatePassword(map[string]any{"min_length": int64(65)}, "x", true),
		"an unknown setting":                    evaluatePassword(map[string]any{"min_lenght": int64(12)}, "x", true),
		"no config":                             evaluatePassword(nil, "x", true),
		"an unknown operation":                  {Operation: "auth.unknown", Config: map[string]any{}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := newEvaluateService(t).Evaluate(ctx, in)
			assert.ErrorIs(t, err, domain.ErrPolicyInvalid(nil, nil))
		})
	}
}

// Every operation with a template has a dry run: a template that lands
// without its case in Evaluate fails here rather than refusing every request.
func TestPolicyService_EvaluateCoversEveryTemplate(t *testing.T) {
	engine := mustPolicyEngine(t)
	for _, operation := range engine.Operations() {
		t.Run(operation, func(t *testing.T) {
			in := service.EvaluatePolicyInput{Operation: operation, Config: map[string]any{}}
			switch operation {
			case service.OperationPasswordSet:
				in.PasswordSet = &service.PasswordSetEvaluation{Password: "x", SelfService: true}
			default:
				t.Fatalf("no dry run input for %s: add its case to Evaluate and here", operation)
			}
			_, err := newEvaluateService(t).Evaluate(context.Background(), in)
			require.NoError(t, err)
		})
	}
}
