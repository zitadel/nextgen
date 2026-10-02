package api

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
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

// TestFactorToAPI_SSO pins that a promoted sso factor renders with its own
// method and no payload: the connection and link ids stay server-side.
func TestFactorToAPI_SSO(t *testing.T) {
	t.Parallel()
	factor := &domain.AuthFactorSSO{ConnectionID: "idp_1", LinkID: "idplink_1"}
	factor.SetLastVerifiedAt(time.Now())

	got := factorToAPI(factor)
	assert.Equal(t, api.FactorMethodSSO, got.Method)
	assert.False(t, got.Payload.Set)
}
