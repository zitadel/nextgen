package httputil

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// Direct-only (ADR 061 decision 4): a proxied fetch dials the proxy's
// address, so the Control hook would check the proxy while the proxy reaches
// the real, possibly denied, target. The transport must ignore environment
// proxy settings whether or not the policy enforces anything.
func TestNewTransportIgnoresEnvironmentProxy(t *testing.T) {
	for _, deny := range [][]string{nil, {"10.0.0.0/8"}} {
		policy, err := NewPolicy(deny, nil)
		require.NoError(t, err)
		transport, ok := newTransport(policy).(*http.Transport)
		require.True(t, ok, "newTransport must return a *http.Transport")
		require.Nil(t, transport.Proxy, "deny=%v: environment proxying must be disabled", deny)
	}
}
