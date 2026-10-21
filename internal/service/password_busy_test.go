package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

// A password check that never ran because the server is hashing as much as it
// allows is not a wrong password: no failed check is recorded (that feeds the
// lockout) and the attempt's proof is not rejected. The service answers with
// the busy code itself, which the API turns into a 429.
func TestAuthAttemptService_VerifyProof_PasswordBusyIsNotAFailure(t *testing.T) {
	ctrl := gomock.NewController(t)
	verifier := cryptomock.NewMockHashVerifier(ctrl)
	stmts := mocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.AuthAttempt{
		ProjectID: "proj",
		ID:        "att-1",
		Checks: []domain.AuthCheck{
			&domain.AuthFactorUser{UserID: "user-1"},
			domain.SetAuthChallengePassword("ch-pass", time.Now(), time.Time{}, 0),
		},
	}, nil)
	stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{EncodedHash: "encoded"}, nil)
	verifier.EXPECT().VerifyHash(gomock.Any(), "encoded", "secret").Return(crypto.ErrHashingBusy)
	// No AuthAttemptChallengeFailed: recording one here fails the test.

	svc := newAuthAttemptSvcWithVerifier(ctrl, stmts, nil, nil, verifier)
	got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
		ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-pass",
		Proof: service.PasswordProof{Password: "secret"},
	})

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrUserPasswordHashingBusy())
	assert.NotErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
}

// A history comparison the limiter refused is neither a match nor a miss; the
// set is answered busy, not failed closed as an internal error.
func TestPasswordPolicy_HistoryBusyPassesThrough(t *testing.T) {
	f := newHistoryFixture(t, 2)
	f.stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{ID: "upw_current", EncodedHash: "current"}, nil)
	f.stmts.EXPECT().GetUserPasswordHistory(gomock.Any(), "p", "u").Return(nil, nil)
	f.verifier.EXPECT().VerifyHash(gomock.Any(), "current", gomock.Any()).Return(crypto.ErrHashingBusy)

	_, err := f.gate.CheckPassword(t.Context(), service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: "candidate", SelfService: true})
	derr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrUserPasswordHashingBusy().Code, derr.Code)
}

// The set-password action carries the busy answer out of the hash as the busy
// code, through HashPassword, rather than as a failure to hash.
func TestSetPasswordAction_Prepare_busy(t *testing.T) {
	ctrl := gomock.NewController(t)
	hasher := cryptomock.NewMockHasher(ctrl)
	hasher.EXPECT().Hash(gomock.Any(), "s3cret").DoAndReturn(func(context.Context, string) (string, error) {
		return "", crypto.ErrHashingBusy
	})

	action := service.NewSetUserPasswordAction(service.SetPasswordInput{
		ProjectID: "proj_1",
		UserID:    "user_1",
		Password:  "s3cret",
	}, service.FixedProjectHasherResolver{Hasher: hasher}, noPolicyGate(t))
	err := action.Prepare(t.Context())
	assert.ErrorIs(t, err, domain.ErrUserPasswordHashingBusy())
}
