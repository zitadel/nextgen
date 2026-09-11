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

// Zoned IPv6 literals ("fe80::1%eth0") reach the dial hook with the zone
// attached; the policy must still evaluate the address, deny and allow alike.
func TestCheckDialAddressZonedIPv6(t *testing.T) {
	denyLinkLocal, err := NewPolicy([]string{"fe80::/10"}, nil)
	require.NoError(t, err)
	var denied *AddressDeniedError
	require.ErrorAs(t, checkDialAddress(denyLinkLocal, "[fe80::1%eth0]:443"), &denied)

	allowZoned, err := NewPolicy([]string{"fe80::/10"}, []string{"fe80::1"})
	require.NoError(t, err)
	require.NoError(t, checkDialAddress(allowZoned, "[fe80::1%eth0]:443"))

	require.Error(t, checkDialAddress(denyLinkLocal, "not-an-address"))
}
