package domain_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

var hexDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)

func TestHashClaimChallengeToken(t *testing.T) {
	t.Parallel()

	// Pinned vector: sha256("claim_challenge_dGVzdC10b2tlbg") hex-encoded. A
	// change to the algorithm or the encoding invalidates every stored
	// challenge id, so the exact output is asserted, not re-derived.
	const token = "claim_challenge_dGVzdC10b2tlbg"
	const want = "225bfb5cc930e400ffe546d12aa3378db147a12278b20e29368c367e966283cc"

	got := domain.HashClaimChallengeToken(token)
	assert.Equal(t, want, got)
	assert.Equal(t, got, domain.HashClaimChallengeToken(token))
	assert.Regexp(t, hexDigest, got)
}

func TestNewClaimChallengeToken(t *testing.T) {
	t.Parallel()

	plain, id, err := domain.NewClaimChallengeToken()
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(plain, "ch_"))
	// Wire pattern pinned by challenge-id.yaml; ogen validates it on both
	// input and output, so a drift here breaks every claim endpoint.
	assert.Regexp(t, `^ch_[a-zA-Z0-9_-]+$`, plain)
	assert.Equal(t, domain.HashClaimChallengeToken(plain), id)
	assert.Regexp(t, hexDigest, id)

	otherPlain, otherID, err := domain.NewClaimChallengeToken()
	require.NoError(t, err)
	assert.NotEqual(t, plain, otherPlain)
	assert.NotEqual(t, id, otherID)
}
