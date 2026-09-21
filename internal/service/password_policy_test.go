package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type verifierFunc func(encoded, target string) error

func (f verifierFunc) VerifyHash(encoded, target string) error { return f(encoded, target) }

func newPasswordPolicy(t *testing.T, instances ...*policy.Instance) *service.PasswordPolicy {
	t.Helper()
	engine, err := policy.New()
	require.NoError(t, err)
	resolver := policy.NewStaticResolver()
	resolver.Add("proj_1", instances...)
	verifier := verifierFunc(func(encoded, target string) error {
		if encoded == "hash:"+target {
			return nil
		}
		return errors.New("mismatch")
	})
	return service.NewPasswordPolicy(engine, resolver, verifier)
}

func instance(t *testing.T, doc string) *policy.Instance {
	t.Helper()
	inst, err := policy.ParseInstance([]byte(doc))
	require.NoError(t, err)
	return inst
}

func TestPasswordPolicyCheck(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("a", 15)

	tests := []struct {
		name       string
		instances  []*policy.Instance
		stored     string // encoded hash of the current password, "" for none
		candidate  string
		wantRules  []string
		wantLookup bool
	}{
		{
			name:      "template defaults reject a short password",
			candidate: "short",
			wantRules: []string{"min_length"},
		},
		{
			name:      "template defaults accept fifteen characters",
			candidate: long,
		},
		{
			name:      "project instance lowers the minimum within the floor",
			instances: []*policy.Instance{instance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":8}}`)},
			candidate: "eightchr",
		},
		{
			name:       "history rejects the current password",
			instances:  []*policy.Instance{instance(t, `{"kind":"policy","operation":"user.password.save","config":{"history_depth":1}}`)},
			stored:     "hash:" + long,
			candidate:  long,
			wantRules:  []string{"history"},
			wantLookup: true,
		},
		{
			name:       "history allows a different password",
			instances:  []*policy.Instance{instance(t, `{"kind":"policy","operation":"user.password.save","config":{"history_depth":1}}`)},
			stored:     "hash:" + long,
			candidate:  long + "b",
			wantLookup: true,
		},
		{
			name:       "first password has no history to match",
			instances:  []*policy.Instance{instance(t, `{"kind":"policy","operation":"user.password.save","config":{"history_depth":1}}`)},
			candidate:  long,
			wantLookup: true,
		},
		{
			name:      "audit mode records the stricter rule but does not block",
			instances: []*policy.Instance{instance(t, `{"kind":"policy","operation":"user.password.save","enforcement":"audit","config":{"min_length":20}}`)},
			candidate: long,
		},
		{
			name:      "audit mode still enforces the baseline",
			instances: []*policy.Instance{instance(t, `{"kind":"policy","operation":"user.password.save","enforcement":"audit","config":{"min_length":20}}`)},
			candidate: "short",
			wantRules: []string{"min_length"},
		},
		{
			name:      "length counts code points after NFC, not bytes",
			candidate: strings.Repeat("e\u0301", 8), // 8 decomposed é: 24 bytes, 16 code points raw, 8 after NFC
			wantRules: []string{"min_length"},
		},
		{
			name:      "fifteen composed characters pass regardless of input form",
			candidate: strings.Repeat("e\u0301", 15),
		},
		{
			name:      "above the fixed maximum is rejected",
			candidate: strings.Repeat("a", 65),
			wantRules: []string{"max_length"},
		},
		{
			name:       "every violated rule is reported",
			instances:  []*policy.Instance{instance(t, `{"kind":"policy","operation":"user.password.save","config":{"history_depth":1}}`)},
			stored:     "hash:short",
			candidate:  "short",
			wantRules:  []string{"min_length", "history"},
			wantLookup: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			if tt.wantLookup {
				call := stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any())
				if tt.stored == "" {
					call.Return(nil, database.NewNoRowFoundError(nil))
				} else {
					call.Return(&domain.UserPassword{EncodedHash: tt.stored}, nil)
				}
			}
			pol := newPasswordPolicy(t, tt.instances...)
			err := pol.Check(t.Context(), stmts, "proj_1", "user_1", tt.candidate)
			if tt.wantRules == nil {
				require.NoError(t, err)
				return
			}
			derr, ok := errors.AsType[domain.Error](err)
			require.True(t, ok, "expected a domain error, got %v", err)
			require.Equal(t, "user.password_policy_violation", derr.Code)
			details, ok := derr.Details.(domain.PasswordPolicyViolationDetails)
			require.True(t, ok, "details = %T", derr.Details)
			var got []string
			for _, v := range details.Violations {
				got = append(got, v.Rule)
			}
			require.Equal(t, tt.wantRules, got)
		})
	}
}

func TestPasswordPolicyFieldValidation(t *testing.T) {
	t.Parallel()
	pol := newPasswordPolicy(t, instance(t, `{"kind":"policy","operation":"user.password.save","config":{"min_length":12}}`))
	v, err := pol.FieldValidation(context.Background(), "proj_1")
	require.NoError(t, err)
	require.Equal(t, 12, v.MinLength)
	require.Equal(t, 64, v.MaxLength)

	v, err = pol.FieldValidation(context.Background(), "proj_other")
	require.NoError(t, err)
	require.Equal(t, 15, v.MinLength, "unknown project falls back to the template default")
}

func TestSetPasswordActionAppliesPolicy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	hasher := cryptomock.NewMockHasher(ctrl)
	hasher.EXPECT().Hash("short").Return("hash", nil)
	stmts := servicemocks.NewMockAllStatements(ctrl)

	action := service.NewSetUserPasswordAction(service.SetPasswordInput{
		ProjectID: "proj_1",
		UserID:    "user_1",
		Password:  "short",
	}, hasher).WithPasswordPolicy(newPasswordPolicy(t))
	require.NoError(t, action.Prepare(t.Context()))
	err := action.Apply(t.Context(), stmts)
	derr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok, "expected a domain error, got %v", err)
	require.Equal(t, "user.password_policy_violation", derr.Code)
}
