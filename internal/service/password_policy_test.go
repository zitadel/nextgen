package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// noPolicyGate is the gate the server wires today: the embedded catalog and
// no project instance. It never reads storage or verifies a hash.
func noPolicyGate(t *testing.T) *service.PasswordPolicy {
	t.Helper()
	return newGate(t, service.NoPolicyResolver{}, nil, nil)
}

func newGate(t testing.TB, resolver service.PolicyResolver, verifier crypto.HashVerifier, pool service.StatementPool) *service.PasswordPolicy {
	t.Helper()
	gate, err := service.NewPasswordPolicy(mustPolicyEngine(t), resolver, verifier, pool)
	require.NoError(t, err)
	return gate
}

func TestNewPasswordPolicy_RequiresTheOperationTemplate(t *testing.T) {
	empty, err := policy.New(policy.WithTemplates())
	require.NoError(t, err)
	_, err = service.NewPasswordPolicy(empty, service.NoPolicyResolver{}, nil, nil)
	require.ErrorIs(t, err, policy.ErrUnknownOperation)
}

func mustPolicyEngine(t testing.TB) *policy.Engine {
	t.Helper()
	engine, err := policy.New()
	require.NoError(t, err)
	return engine
}

// fixedPolicy resolves the same instance for every project.
type fixedPolicy struct{ config map[string]any }

func (f fixedPolicy) ResolvePolicy(context.Context, string, string) (*policy.Instance, error) {
	return &policy.Instance{Kind: policy.KindPolicy, Operation: service.OperationPasswordSet, Config: f.config}, nil
}

type failingPolicy struct{}

func (failingPolicy) ResolvePolicy(context.Context, string, string) (*policy.Instance, error) {
	return nil, errors.New("storage down")
}

// checkErr runs the gate and keeps its verdict only.
func checkErr(t testing.TB, gate *service.PasswordPolicy, in service.SetPasswordInput) error {
	t.Helper()
	_, err := gate.CheckPassword(t.Context(), in)
	return err
}

func violations(t *testing.T, err error) map[string]any {
	t.Helper()
	require.Error(t, err)
	derr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok, "want a domain error, got %v", err)
	require.Equal(t, domain.ErrUserPasswordPolicyViolation(nil).Code, derr.Code)
	details, ok := derr.Details.(domain.PasswordPolicyViolations)
	require.True(t, ok, "details are %T", derr.Details)
	return details.Violations
}

func TestPasswordPolicy_NoInstance(t *testing.T) {
	gate := noPolicyGate(t)

	require.NoError(t, checkErr(t, gate, service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: "a"}),
		"no policy: any length within the cap is accepted")

	err := checkErr(t, gate, service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: strings.Repeat("ä", 65)})
	assert.Equal(t, map[string]any{"max_length": int64(64)}, violations(t, err), "the domain cap is reported like the max_length rule")

	require.NoError(t, checkErr(t, gate, service.SetPasswordInput{Password: strings.Repeat("ä", 64)}),
		"64 code points (128 bytes) fit the cap")
}

func TestPasswordPolicy_EmptyIsADomainGuard(t *testing.T) {
	for name, gate := range map[string]*service.PasswordPolicy{
		"no policy":       noPolicyGate(t),
		"with min_length": newGate(t, fixedPolicy{config: map[string]any{"min_length": 12}}, nil, nil),
	} {
		t.Run(name, func(t *testing.T) {
			err := checkErr(t, gate, service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: ""})
			assert.ErrorIs(t, err, domain.ErrUserPasswordEmpty())
		})
	}
}

func TestPasswordPolicy_LengthRules(t *testing.T) {
	gate := newGate(t, fixedPolicy{config: map[string]any{"min_length": 12, "max_length": 32}}, nil, nil)

	tests := []struct {
		name     string
		password string
		want     map[string]any
	}{
		{"too short", "short", map[string]any{"min_length": int64(12)}},
		{"long enough", "correct horse", nil},
		{"too long for the policy", strings.Repeat("x", 33), map[string]any{"max_length": int64(32)}},
		{"over the cap reports the policy's max", strings.Repeat("x", 65), map[string]any{"max_length": int64(32)}},
		{"counted after NFC", strings.Repeat("é", 11), map[string]any{"min_length": int64(12)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkErr(t, gate, service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: tt.password})
			if tt.want == nil {
				require.NoError(t, err)
				return
			}
			assert.Equal(t, tt.want, violations(t, err))
		})
	}
}

func TestPasswordPolicy_FailsClosed(t *testing.T) {
	err := checkErr(t, newGate(t, failingPolicy{}, nil, nil), service.SetPasswordInput{Password: "anything long enough"})
	derr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrInternal(nil).Code, derr.Code)

	invalid := newGate(t, fixedPolicy{config: map[string]any{"min_length": 99}}, nil, nil)
	derr, ok = errors.AsType[domain.Error](checkErr(t, invalid, service.SetPasswordInput{Password: "x"}))
	require.True(t, ok)
	assert.Equal(t, domain.ErrInternal(nil).Code, derr.Code, "a stored instance the template rejects fails closed")
}

type historyFixture struct {
	gate     *service.PasswordPolicy
	stmts    *servicemocks.MockAllStatements
	verifier *cryptomock.MockHashVerifier
}

func newHistoryFixture(t *testing.T, depth int) *historyFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	verifier := cryptomock.NewMockHashVerifier(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	gate := newGate(t, fixedPolicy{config: map[string]any{"history_depth": depth}}, verifier, pool)
	return &historyFixture{gate: gate, stmts: stmts, verifier: verifier}
}

// kept seeds the current password and the previous ones, newest first, and
// a verifier that matches the candidate against the hash named "match". The
// history read and the verifications must happen exactly as often as given:
// each verification is a deliberately slow hash.
func (f *historyFixture) kept(historyReads, verifications int, current string, previous ...string) {
	f.stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{ID: "upw_current", EncodedHash: current}, nil)
	rows := make([]*domain.UserPassword, len(previous))
	for i, h := range previous {
		rows[i] = &domain.UserPassword{EncodedHash: h}
	}
	f.stmts.EXPECT().GetUserPasswordHistory(gomock.Any(), "p", "u").Return(rows, nil).Times(historyReads)
	f.verifier.EXPECT().VerifyHash(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, hash, _ string) error {
		switch hash {
		case "match":
			return nil
		case "unreadable":
			return errors.New("no verifier for this hash")
		}
		return crypto.ErrHashMismatch
	}).Times(verifications)
}

func TestPasswordPolicy_History(t *testing.T) {
	selfService := service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: "candidate", SelfService: true}

	t.Run("matches the current password", func(t *testing.T) {
		f := newHistoryFixture(t, 1)
		f.kept(0, 1, "match", "other") // depth 1: the history is not even read
		assert.Equal(t, map[string]any{"history_depth": int64(1)}, violations(t, checkErr(t, f.gate, selfService)))
	})

	t.Run("matches a previous password within the depth", func(t *testing.T) {
		f := newHistoryFixture(t, 3)
		f.kept(1, 3, "a", "b", "match", "c")
		assert.Equal(t, map[string]any{"history_depth": int64(3)}, violations(t, checkErr(t, f.gate, selfService)))
	})

	t.Run("a match beyond the depth is not checked", func(t *testing.T) {
		f := newHistoryFixture(t, 2)
		f.kept(1, 2, "a", "b", "match") // only two hashes are verified
		check, err := f.gate.CheckPassword(t.Context(), selfService)
		require.NoError(t, err)
		assert.Equal(t, service.PasswordCheck{HistoryChecked: true, CurrentPasswordID: "upw_current"}, check,
			"the write must still replace the password the check compared with")
	})

	t.Run("a user without a password has no history", func(t *testing.T) {
		f := newHistoryFixture(t, 4)
		f.stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(nil, new(database.NoRowFoundError))
		check, err := f.gate.CheckPassword(t.Context(), selfService)
		require.NoError(t, err)
		assert.Equal(t, service.PasswordCheck{HistoryChecked: true}, check, "the write must still be the first password")
	})

	t.Run("not self-service: nothing is read or verified", func(t *testing.T) {
		f := newHistoryFixture(t, 4)
		admin := selfService
		admin.SelfService = false
		check, err := f.gate.CheckPassword(t.Context(), admin)
		require.NoError(t, err)
		assert.Zero(t, check)
	})

	t.Run("over the cap: nothing is read or verified", func(t *testing.T) {
		f := newHistoryFixture(t, 4) // no EXPECT: reading or verifying fails the test
		long := selfService
		long.Password = strings.Repeat("ä", domain.MaxPasswordLength+1)
		assert.Equal(t, map[string]any{"max_length": int64(domain.MaxPasswordLength)}, violations(t, checkErr(t, f.gate, long)))
	})

	t.Run("a hash that cannot be verified fails closed", func(t *testing.T) {
		f := newHistoryFixture(t, 2)
		f.kept(1, 2, "a", "unreadable")
		derr, ok := errors.AsType[domain.Error](checkErr(t, f.gate, selfService))
		require.True(t, ok)
		assert.Equal(t, domain.ErrInternal(nil).Code, derr.Code)
	})

	t.Run("a storage error fails closed", func(t *testing.T) {
		f := newHistoryFixture(t, 4)
		f.stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(nil, errors.New("down"))
		derr, ok := errors.AsType[domain.Error](checkErr(t, f.gate, selfService))
		require.True(t, ok)
		assert.Equal(t, domain.ErrInternal(nil).Code, derr.Code)
	})
}

func TestSetPasswordAction_GateRunsBeforeTheHash(t *testing.T) {
	ctrl := gomock.NewController(t)
	hasher := cryptomock.NewMockHasher(ctrl) // no EXPECT: hashing must not happen
	gate := newGate(t, fixedPolicy{config: map[string]any{"min_length": 12}}, nil, nil)

	action := service.NewSetUserPasswordAction(service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: "short"},
		service.FixedProjectHasherResolver{Hasher: hasher}, gate)
	violations(t, action.Prepare(t.Context()))
}

// A self-service change checked against the history must not land when
// another change committed between its check and its write: the other change
// may have set this very password. The write sees it as the password it
// replaced.
func TestSetPasswordAction_RejectsAStaleHistoryCheck(t *testing.T) {
	for name, tt := range map[string]struct {
		replaced []*domain.UserPassword
		want     error
	}{
		"replaces the password it was checked against":        {replaced: []*domain.UserPassword{{ID: "upw_current"}}},
		"another change landed in between":                    {replaced: []*domain.UserPassword{{ID: "upw_other"}, {ID: "upw_current"}}, want: domain.ErrUserConflict()},
		"replaces nothing, though it was checked against one": {replaced: nil, want: domain.ErrUserConflict()},
	} {
		t.Run(name, func(t *testing.T) {
			f := newHistoryFixture(t, 1)
			f.kept(0, 1, "a")
			hasher := cryptomock.NewMockHasher(gomock.NewController(t))
			hasher.EXPECT().Hash(gomock.Any(), "candidate").Return("hash", nil)
			action := service.NewSetUserPasswordAction(
				service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: "candidate", SelfService: true},
				service.FixedProjectHasherResolver{Hasher: hasher}, f.gate)
			require.NoError(t, action.Prepare(t.Context()))

			f.stmts.EXPECT().SetUserPassword(gomock.Any(), gomock.Any()).Return(nil)
			f.stmts.EXPECT().GetUserPasswordHistory(gomock.Any(), "p", "u").Return(tt.replaced, nil)
			if tt.want == nil {
				f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil)
			}
			err := action.Apply(t.Context(), f.stmts)
			if tt.want == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.want)
		})
	}
}

func TestSetPasswordAction_NoGateFailsClosed(t *testing.T) {
	action := service.NewSetUserPasswordAction(service.SetPasswordInput{Password: "anything"}, nil, nil)
	derr, ok := errors.AsType[domain.Error](action.Prepare(t.Context()))
	require.True(t, ok)
	assert.Equal(t, domain.ErrInternal(nil).Code, derr.Code)
}
