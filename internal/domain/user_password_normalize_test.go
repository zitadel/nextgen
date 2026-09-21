package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestPasswordsAreNFCNormalizedBeforeHashingAndVerification(t *testing.T) {
	t.Parallel()
	const decomposed = "café" // e + combining acute
	const composed = "café"

	ctrl := gomock.NewController(t)
	hasher := cryptomock.NewMockHasher(ctrl)
	hasher.EXPECT().Hash(composed).Return("hash", nil)
	_, err := domain.HashPassword(decomposed, hasher)
	require.NoError(t, err)

	verifier := cryptomock.NewMockHashVerifier(ctrl)
	verifier.EXPECT().VerifyHash("hash", composed).Return(nil)
	pw := &domain.UserPassword{EncodedHash: "hash"}
	require.NoError(t, pw.Verify(decomposed, verifier))
}
