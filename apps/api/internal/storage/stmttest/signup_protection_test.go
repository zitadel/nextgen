//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto/pow/powtest"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/oidc/v3/pkg/op"
)

type signupTestKeys struct {
	service.KeyService
	crypter op.Crypto
	id      string
}

func (k signupTestKeys) GetProjectCrypter(context.Context, string, domain.EncryptionKeyPurpose) (op.Crypto, error) {
	return k.crypter, nil
}
func (k signupTestKeys) GetCrypter(_ context.Context, id string, _ jose.ContentEncryption) (op.Crypto, error) {
	if id != k.id {
		return nil, fmt.Errorf("unexpected key id %s", id)
	}
	return k.crypter, nil
}
func signupService(t *testing.T, d dialect) service.SignupProtection {
	t.Helper()
	var key [32]byte
	_, err := rand.Read(key[:])
	require.NoError(t, err)
	id, err := d.stmts.NewManagedID(string(domain.PrefixEncryptionKey))
	require.NoError(t, err)
	return service.NewSignupProtection(service.NewPool(d.pool), signupTestKeys{crypter: op.NewAES256GCMCrypto(key, id), id: id})
}
func TestSignupProtection(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := ensureProject(t, d.stmts)
		flow, err := d.stmts.NewManagedID(string(domain.PrefixFlow))
		require.NoError(t, err)
		state := &domain.FlowState{ProjectID: project, ID: flow}
		svc := signupService(t, d)
		challenge, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		same, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		require.Equal(t, challenge, same)
		limits, err := readSignupLimits(t, d, project, flow)
		require.NoError(t, err)
		require.EqualValues(t, 1, limits.Issued)
		proof := powtest.Solve(t, challenge)
		require.ErrorIs(t, svc.Consume(t.Context(), state, ""), domain.ErrFlowProofInvalid())
		otherFlow := *state
		otherFlow.ID += "_other"
		require.ErrorIs(t, svc.Consume(t.Context(), &otherFlow, proof), domain.ErrFlowProofInvalid())
		otherProject := *state
		otherProject.ProjectID = ensureProject(t, d.stmts)
		require.ErrorIs(t, svc.Consume(t.Context(), &otherProject, proof), domain.ErrFlowProofInvalid())
		// The compare/delete must admit exactly one request, including across replicas.
		var successes atomic.Int32
		var wg sync.WaitGroup
		errs := make(chan error, 8)
		for range 8 {
			wg.Go(func() {
				err := svc.Consume(t.Context(), state, proof)
				if err == nil {
					successes.Add(1)
				} else {
					errs <- err
				}
			})
		}
		wg.Wait()
		close(errs)
		require.EqualValues(t, 1, successes.Load())
		for err := range errs {
			require.ErrorIs(t, err, domain.ErrFlowProofInvalid())
		}
		require.ErrorIs(t, svc.Consume(t.Context(), state, proof), domain.ErrFlowProofInvalid())
		next, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		require.NotEqual(t, challenge.ChallengeID, next.ChallengeID)
		// A new pending challenge does not make an old solved proof usable again.
		require.ErrorIs(t, svc.Consume(t.Context(), state, proof), domain.ErrFlowProofInvalid())
		limits, err = readSignupLimits(t, d, project, flow)
		require.NoError(t, err)
		limits.Issued = 10
		limits.Verified = 20
		require.NoError(t, d.stmts.UpdateSignupLimits(t.Context(), limits))
		// Exhausting one flow never prevents another flow from signing up.
		_, err = svc.Challenge(t.Context(), &otherFlow)
		require.NoError(t, err)
		require.ErrorIs(t, svc.Consume(t.Context(), state, proof), domain.ErrFlowRateLimited())
		reused, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		require.Equal(t, next, reused)
		limits.WindowStart = time.Now().Add(-2 * time.Minute).Unix()
		require.NoError(t, d.stmts.UpdateSignupLimits(t.Context(), limits))
		require.ErrorIs(t, svc.Consume(t.Context(), state, proof), domain.ErrFlowProofInvalid())
		limits, err = readSignupLimits(t, d, project, flow)
		require.NoError(t, err)
		require.Zero(t, limits.Issued)
		require.EqualValues(t, 1, limits.Verified)
	})
}
func TestSignupChallengeExpiry(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := ensureProject(t, d.stmts)
		now := time.Now().Unix()
		record := &domain.SignupChallengeRecord{ProjectID: project, FlowID: "expired_flow", ID: "expired_challenge", ExpiresAt: now, Payload: "must never decrypt"}
		require.NoError(t, d.stmts.CreateSignupChallenge(t.Context(), record))
		consumed, err := d.stmts.ConsumeSignupChallenge(t.Context(), project, record.FlowID, record.ID, now)
		require.NoError(t, err)
		require.False(t, consumed)
		require.NoError(t, d.stmts.InsertSignupLimits(t.Context(), &domain.SignupLimits{ProjectID: project, FlowID: "inactive", WindowStart: now - 3601}))
		active := &domain.SignupChallengeRecord{ProjectID: project, FlowID: "active", ID: "active_challenge", ExpiresAt: now + 300}
		require.NoError(t, d.stmts.CreateSignupChallenge(t.Context(), active))
		require.NoError(t, d.stmts.InsertSignupLimits(t.Context(), &domain.SignupLimits{ProjectID: project, FlowID: active.FlowID, WindowStart: now}))
		otherProject := ensureProject(t, d.stmts)
		other := &domain.SignupChallengeRecord{ProjectID: otherProject, FlowID: "other", ID: "other_challenge", ExpiresAt: now}
		require.NoError(t, d.stmts.CreateSignupChallenge(t.Context(), other))
		require.NoError(t, d.stmts.InsertSignupLimits(t.Context(), &domain.SignupLimits{ProjectID: otherProject, FlowID: other.FlowID, WindowStart: now - 3601}))
		require.NoError(t, d.stmts.DeleteExpiredSignupProtection(t.Context(), project, now, 1000))
		limits, err := readSignupLimits(t, d, project, "inactive")
		require.NoError(t, err)
		require.Nil(t, limits)
		missing, err := d.stmts.GetSignupChallenge(t.Context(), project, record.FlowID)
		require.NoError(t, err)
		require.Nil(t, missing)
		for _, retained := range []*domain.SignupChallengeRecord{active, other} {
			challenge, err := d.stmts.GetSignupChallenge(t.Context(), retained.ProjectID, retained.FlowID)
			require.NoError(t, err)
			require.Equal(t, retained, challenge)
			limits, err := readSignupLimits(t, d, retained.ProjectID, retained.FlowID)
			require.NoError(t, err)
			require.NotNil(t, limits)
		}
	})
}

// A sweep deletes a bounded batch of each table, so a backlog drains over
// several sweeps and rows not yet expired stay.
func TestSignupSweepDeletesABoundedBatch(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := ensureProject(t, d.stmts)
		now := time.Now().Unix()
		expired := []string{"expired_a", "expired_b", "expired_c"}
		for _, flow := range expired {
			require.NoError(t, d.stmts.CreateSignupChallenge(t.Context(), &domain.SignupChallengeRecord{ProjectID: project, FlowID: flow, ID: flow + "_challenge", ExpiresAt: now}))
			require.NoError(t, d.stmts.InsertSignupLimits(t.Context(), &domain.SignupLimits{ProjectID: project, FlowID: flow, WindowStart: now - 3601}))
		}
		active := &domain.SignupChallengeRecord{ProjectID: project, FlowID: "active", ID: "active_challenge", ExpiresAt: now + 300}
		require.NoError(t, d.stmts.CreateSignupChallenge(t.Context(), active))
		require.NoError(t, d.stmts.InsertSignupLimits(t.Context(), &domain.SignupLimits{ProjectID: project, FlowID: active.FlowID, WindowStart: now}))

		remaining := func() (challenges, limits int) {
			t.Helper()
			for _, flow := range expired {
				challenge, err := d.stmts.GetSignupChallenge(t.Context(), project, flow)
				require.NoError(t, err)
				if challenge != nil {
					challenges++
				}
				counter, err := readSignupLimits(t, d, project, flow)
				require.NoError(t, err)
				if counter != nil {
					limits++
				}
			}
			return challenges, limits
		}

		require.NoError(t, d.stmts.DeleteExpiredSignupProtection(t.Context(), project, now, 2))
		challenges, limits := remaining()
		require.Equal(t, 1, challenges)
		require.Equal(t, 1, limits)

		require.NoError(t, d.stmts.DeleteExpiredSignupProtection(t.Context(), project, now, 2))
		challenges, limits = remaining()
		require.Zero(t, challenges)
		require.Zero(t, limits)
		kept, err := d.stmts.GetSignupChallenge(t.Context(), project, active.FlowID)
		require.NoError(t, err)
		require.Equal(t, active, kept)
		counter, err := readSignupLimits(t, d, project, active.FlowID)
		require.NoError(t, err)
		require.NotNil(t, counter)
	})
}

func TestSignupIssuanceBudgetConcurrent(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := ensureProject(t, d.stmts)
		require.NoError(t, d.stmts.InsertSignupLimits(t.Context(), &domain.SignupLimits{ProjectID: project, FlowID: "shared_flow", WindowStart: time.Now().Unix(), Issued: 9}))
		svc := signupService(t, d)
		var wg sync.WaitGroup
		var issued atomic.Int32
		errs := make(chan error, 8)
		for range 8 {
			flow := "shared_flow"
			wg.Go(func() {
				_, err := svc.Challenge(t.Context(), &domain.FlowState{ProjectID: project, ID: flow})
				if err == nil {
					issued.Add(1)
				} else {
					errs <- err
				}
			})
		}
		wg.Wait()
		close(errs)
		require.Positive(t, issued.Load())
		limits, err := readSignupLimits(t, d, project, "shared_flow")
		require.NoError(t, err)
		require.EqualValues(t, 10, limits.Issued)
		for err := range errs {
			require.ErrorIs(t, err, domain.ErrFlowRateLimited())
		}
	})
}

type failedSignupMutation struct {
	service.UserService
	err error
}

func (s failedSignupMutation) ApplyActions(context.Context, ...service.UserAction) error {
	return s.err
}
func TestSignupProofSpentOnMutationFailure(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := ensureProject(t, d.stmts)
		flow, err := d.stmts.NewManagedID(string(domain.PrefixFlow))
		require.NoError(t, err)
		state := &domain.FlowState{ProjectID: project, ID: flow, FlowProgress: domain.FlowProgress{CollectedData: domain.CollectedFlowData{AuthMethods: domain.CollectedAuthMethodData{Password: "a password"}}}}
		protection := signupService(t, d)
		challenge, err := protection.Challenge(t.Context(), state)
		require.NoError(t, err)
		proof := powtest.Solve(t, challenge)
		failed := errors.New("mutation failed")
		handler := service.NewFlowCreateUserHandler(nil, signupPasswordGate{}, failedSignupMutation{err: failed}, nil, service.NewPool(d.pool), protection)
		_, err = handler.Handle(t.Context(), domain.FlowOnSuccessInput{ProjectID: project, State: state, GateProofs: map[string]string{domain.SignupGate: proof}})
		require.ErrorIs(t, err, failed)
		require.ErrorIs(t, protection.Consume(t.Context(), state, proof), domain.ErrFlowProofInvalid())
		next, err := protection.Challenge(t.Context(), state)
		require.NoError(t, err)
		require.NotEqual(t, challenge.ChallengeID, next.ChallengeID)
	})
}

type signupPasswordGate struct{}

func (signupPasswordGate) CheckPassword(context.Context, service.SetPasswordInput) (service.PasswordCheck, error) {
	return service.PasswordCheck{}, nil
}

func TestSignupRefreshesNearExpiry(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := ensureProject(t, d.stmts)
		state := &domain.FlowState{ProjectID: project, ID: "near_expiry_flow"}
		svc := signupService(t, d)
		first, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		record, err := d.stmts.GetSignupChallenge(t.Context(), project, state.ID)
		require.NoError(t, err)
		record.ExpiresAt = time.Now().Add(30 * time.Second).Unix()
		record.Payload = "must not decrypt while refreshing"
		require.NoError(t, d.stmts.CreateSignupChallenge(t.Context(), record))
		fresh, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		require.NotEqual(t, first.ChallengeID, fresh.ChallengeID)
		require.Greater(t, fresh.ExpiresAt.Unix(), time.Now().Add(time.Minute).Unix())
	})
}

// LockSignupLimits is a read-write transaction operation, including on Spanner.
func readSignupLimits(t *testing.T, d dialect, project, flow string) (limits *domain.SignupLimits, err error) {
	t.Helper()
	err = service.NewPool(d.pool).Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		var err error
		limits, err = tx.Statements().LockSignupLimits(ctx, project, flow)
		return err
	})
	return limits, err
}
