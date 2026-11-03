//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto/pow"
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
func solveSignup(t *testing.T, c *pow.PublicChallenge) string {
	t.Helper()
	salt, err := hex.DecodeString(c.Salt)
	require.NoError(t, err)
	nonce, err := hex.DecodeString(c.Nonce)
	require.NoError(t, err)
	input := make([]byte, 20)
	copy(input, nonce)
	for counter := uint32(0); counter < 512; counter++ {
		binary.BigEndian.PutUint32(input[16:], counter)
		key, err := pbkdf2.Key(sha256.New, string(input), salt, 5000, 32)
		require.NoError(t, err)
		if hex.EncodeToString(key[:16]) == c.KeyPrefix {
			raw, err := json.Marshal(map[string]string{"protocol": c.Protocol, "challenge_id": c.ChallengeID, "derived_key": hex.EncodeToString(key)})
			require.NoError(t, err)
			return string(raw)
		}
	}
	t.Fatal("no solution in profile")
	return ""
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
		limits, err := d.stmts.GetSignupLimits(t.Context(), project)
		require.NoError(t, err)
		require.EqualValues(t, 1, limits.Issued)
		proof := solveSignup(t, challenge)
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
		limits, err = d.stmts.GetSignupLimits(t.Context(), project)
		require.NoError(t, err)
		limits.Issued = 60
		limits.Verified = 120
		require.NoError(t, d.stmts.UpdateSignupLimits(t.Context(), limits))
		_, err = svc.Challenge(t.Context(), &otherFlow)
		require.ErrorIs(t, err, domain.ErrFlowRateLimited())
		require.ErrorIs(t, svc.Consume(t.Context(), state, proof), domain.ErrFlowRateLimited())
		reused, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		require.Equal(t, next, reused)
		limits.WindowStart = time.Now().Add(-2 * time.Minute).Unix()
		require.NoError(t, d.stmts.UpdateSignupLimits(t.Context(), limits))
		_, err = svc.Challenge(t.Context(), &otherFlow)
		require.NoError(t, err)
		limits, err = d.stmts.GetSignupLimits(t.Context(), project)
		require.NoError(t, err)
		require.EqualValues(t, 1, limits.Issued)
		require.Zero(t, limits.Verified)
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
		require.NoError(t, d.stmts.DeleteExpiredSignupChallenges(t.Context(), project, now))
		missing, err := d.stmts.GetSignupChallenge(t.Context(), project, record.FlowID)
		require.NoError(t, err)
		require.Nil(t, missing)
	})
}

func TestSignupIssuanceBudgetConcurrent(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := ensureProject(t, d.stmts)
		require.NoError(t, d.stmts.InsertSignupLimits(t.Context(), &domain.SignupLimits{ProjectID: project, WindowStart: time.Now().Unix(), Issued: 59}))
		svc := signupService(t, d)
		var wg sync.WaitGroup
		var issued atomic.Int32
		errs := make(chan error, 8)
		for range 8 {
			flow, err := d.stmts.NewManagedID(string(domain.PrefixFlow))
			require.NoError(t, err)
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
		require.EqualValues(t, 1, issued.Load())
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
		proof := solveSignup(t, challenge)
		failed := errors.New("mutation failed")
		handler := service.NewFlowCreateUserHandler(nil, nil, failedSignupMutation{err: failed}, nil, service.NewPool(d.pool), protection)
		_, err = handler.Handle(t.Context(), domain.FlowOnSuccessInput{ProjectID: project, State: state, GateProofs: map[string]string{domain.SignupGate: proof}})
		require.ErrorIs(t, err, failed)
		require.ErrorIs(t, protection.Consume(t.Context(), state, proof), domain.ErrFlowProofInvalid())
		next, err := protection.Challenge(t.Context(), state)
		require.NoError(t, err)
		require.NotEqual(t, challenge.ChallengeID, next.ChallengeID)
	})
}
