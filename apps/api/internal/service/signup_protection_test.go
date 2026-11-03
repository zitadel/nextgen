package service_test

import (
	"context"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto/pow"
	"github.com/zitadel/nextgen/internal/crypto/pow/powtest"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/oidc/v3/pkg/op"
)

func TestSignupProofExpiresWhileWaitingForLock(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		stmts := servicemocks.NewMockAllStatements(ctrl)
		keys := servicemocks.NewMockKeyService(ctrl)
		crypter := op.NewAES256GCMCrypto([32]byte{1}, "enc_key_signup_test")
		keys.EXPECT().GetProjectCrypter(gomock.Any(), "project", domain.EncryptionKeyPurposeSecret).Return(crypter, nil)
		keys.EXPECT().GetCrypter(gomock.Any(), "enc_key_signup_test", gomock.Any()).Return(crypter, nil)
		pool.EXPECT().Statements().Return(stmts).AnyTimes()
		pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
			func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
				return fn(ctx, v2TestTx{stmts: stmts})
			}).AnyTimes()
		stmts.EXPECT().LockSignupLimits(gomock.Any(), "project", "flow").Return(&domain.SignupLimits{
			ProjectID: "project", WindowStart: time.Now().Unix(),
		}, nil).Times(3)
		stmts.EXPECT().UpdateSignupLimits(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
		var record *domain.SignupChallengeRecord
		stmts.EXPECT().GetSignupChallenge(gomock.Any(), "project", "flow").DoAndReturn(
			func(context.Context, string, string) (*domain.SignupChallengeRecord, error) { return record, nil },
		).AnyTimes()
		stmts.EXPECT().InsertSignupLimits(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
		stmts.EXPECT().NewManagedID(string(domain.PrefixChallenge)).Return("challenge", nil)
		stmts.EXPECT().DeleteExpiredSignupChallenges(gomock.Any(), "project", gomock.Any()).Return(nil)
		stmts.EXPECT().CreateSignupChallenge(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, r *domain.SignupChallengeRecord) error { record = r; return nil },
		)
		stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
		svc := service.NewSignupProtection(pool, keys)
		state := &domain.FlowState{ProjectID: "project", ID: "flow"}
		challenge, err := svc.Challenge(t.Context(), state)
		require.NoError(t, err)
		proof := powtest.Solve(t, challenge)
		stmts.EXPECT().LockSignupLimits(gomock.Any(), "project", "flow").DoAndReturn(func(context.Context, string, string) (*domain.SignupLimits, error) {
			time.Sleep(pow.MaxLifetime)
			return &domain.SignupLimits{}, nil
		})
		stmts.EXPECT().ConsumeSignupChallenge(gomock.Any(), "project", "flow", "challenge", gomock.Any()).DoAndReturn(
			func(_ context.Context, _, _, _ string, now int64) (bool, error) {
				return record.ExpiresAt > now, nil
			},
		)
		require.ErrorIs(t, svc.Consume(t.Context(), state, proof), domain.ErrFlowProofInvalid())
	})
}
