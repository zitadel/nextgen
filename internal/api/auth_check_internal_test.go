package api

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// TestChecksToAPI_SkipsSSOCallback pins that the SSO state record never
// reaches the wire. It holds by construction, because the record is neither an
// AuthFactor nor an AuthChallenge, and there is no wire method for it.
func TestChecksToAPI_SkipsSSOCallback(t *testing.T) {
	t.Parallel()
	checks := []domain.AuthCheck{
		domain.SetAuthFactorPassword(time.Now()),
		&domain.SSOCallbackCheck{
			ID:     "statehash",
			Result: &domain.SSOCallbackResult{Subject: "sub-1"},
		},
	}

	factors, challenges := checksToAPI(checks)
	require.Len(t, factors, 1)
	assert.Empty(t, challenges)
	assert.Equal(t, checkTypeToAPI(domain.AuthCheckTypePassword), factors[0].Method)
	assert.Empty(t, checkTypeToAPI(domain.AuthCheckTypeSSOCallback))
}
