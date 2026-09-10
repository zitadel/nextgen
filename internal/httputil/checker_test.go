package httputil_test

import (
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/httputil"
)

func TestNewHostChecker(t *testing.T) {
	t.Run("classifies CIDR, IP, and hostname", func(t *testing.T) {
		cidr, err := httputil.NewHostChecker("10.0.0.0/8")
		require.NoError(t, err)
		assert.NotNil(t, cidr.Net)

		ip, err := httputil.NewHostChecker("127.0.0.1")
		require.NoError(t, err)
		assert.NotNil(t, ip.IP)

		domain, err := httputil.NewHostChecker("localhost")
		require.NoError(t, err)
		assert.Equal(t, "localhost", domain.Domain)
	})

	t.Run("empty entry is nil", func(t *testing.T) {
		checker, err := httputil.NewHostChecker("")
		require.NoError(t, err)
		assert.Nil(t, checker)
	})

	t.Run("malformed CIDR is an error, not a hostname", func(t *testing.T) {
		_, err := httputil.NewHostChecker("10.0.0.0/33")
		require.Error(t, err)
	})
}

func TestNewPolicy(t *testing.T) {
	t.Run("rejects malformed entries in either list", func(t *testing.T) {
		_, err := httputil.NewPolicy([]string{"10.0.0.0/33"}, nil)
		require.ErrorContains(t, err, "deny list")

		_, err = httputil.NewPolicy([]string{"10.0.0.0/8"}, []string{"bad/cidr"})
		require.ErrorContains(t, err, "allow list")
	})
}

func mustPolicy(t *testing.T, deny, allow []string) *httputil.Policy {
	t.Helper()
	policy, err := httputil.NewPolicy(deny, allow)
	require.NoError(t, err)
	return policy
}

func TestPolicy_Check(t *testing.T) {
	tests := []struct {
		name    string
		deny    []string
		allow   []string
		ips     []net.IP
		address string
		denied  bool
	}{
		{
			name: "CIDR match denies", deny: []string{"10.0.0.0/8"},
			ips: []net.IP{net.ParseIP("10.1.2.3")}, address: "10.1.2.3", denied: true,
		},
		{
			name: "exact IP match denies", deny: []string{"192.168.1.1"},
			ips: []net.IP{net.ParseIP("192.168.1.1")}, address: "192.168.1.1", denied: true,
		},
		{
			name: "hostname match denies", deny: []string{"localhost"},
			ips: nil, address: "LOCALHOST", denied: true,
		},
		{
			name: "no match allows", deny: []string{"10.0.0.0/8", "localhost"},
			ips: []net.IP{net.ParseIP("93.184.216.34")}, address: "example.com", denied: false,
		},
		{
			name: "allow IP overrides deny CIDR", deny: []string{"127.0.0.0/8"}, allow: []string{"127.0.0.1"},
			ips: []net.IP{net.ParseIP("127.0.0.1")}, address: "127.0.0.1", denied: false,
		},
		{
			name: "allow CIDR overrides deny CIDR", deny: []string{"10.0.0.0/8"}, allow: []string{"10.1.0.0/16"},
			ips: []net.IP{net.ParseIP("10.1.2.3")}, address: "10.1.2.3", denied: false,
		},
		{
			name: "allow hostname overrides deny hostname", deny: []string{"localhost"}, allow: []string{"localhost"},
			ips: nil, address: "localhost", denied: false,
		},
		{
			name: "allow entry does not cover a different denied IP", deny: []string{"127.0.0.0/8"}, allow: []string{"127.0.0.1"},
			ips: []net.IP{net.ParseIP("127.0.0.2")}, address: "127.0.0.2", denied: true,
		},
		{
			name: "empty deny list enforces nothing", deny: nil, allow: []string{"127.0.0.1"},
			ips: []net.IP{net.ParseIP("10.0.0.1")}, address: "10.0.0.1", denied: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := mustPolicy(t, tt.deny, tt.allow).Check(tt.ips, tt.address)
			if tt.denied {
				var denied *httputil.AddressDeniedError
				require.ErrorAs(t, err, &denied)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestPolicy_CheckAddress(t *testing.T) {
	t.Run("hostname deny entry blocks by name, no resolution", func(t *testing.T) {
		policy := mustPolicy(t, []string{"blocked.test"}, nil)
		var denied *httputil.AddressDeniedError
		require.ErrorAs(t, policy.CheckAddress("blocked.test"), &denied)
	})

	t.Run("literal IP host matches CIDR entries", func(t *testing.T) {
		policy := mustPolicy(t, []string{"169.254.0.0/16"}, nil)
		var denied *httputil.AddressDeniedError
		require.ErrorAs(t, policy.CheckAddress("169.254.169.254"), &denied)
	})

	t.Run("trailing-dot spelling cannot bypass a name entry", func(t *testing.T) {
		policy := mustPolicy(t, []string{"blocked.test"}, nil)
		var denied *httputil.AddressDeniedError
		require.ErrorAs(t, policy.CheckAddress("blocked.test."), &denied)

		dotted := mustPolicy(t, []string{"blocked.test."}, nil)
		require.ErrorAs(t, dotted.CheckAddress("blocked.test"), &denied)
	})

	t.Run("unmatched domain passes without resolution", func(t *testing.T) {
		// A domain resolving to a denied IP is the dial-time check's job;
		// CheckAddress never resolves.
		policy := mustPolicy(t, []string{"127.0.0.0/8"}, nil)
		require.NoError(t, policy.CheckAddress("innocent.test"))
	})

	t.Run("allow hostname counters deny hostname", func(t *testing.T) {
		policy := mustPolicy(t, []string{"localhost", "127.0.0.0/8"}, []string{"localhost"})
		require.NoError(t, policy.CheckAddress("localhost"))
	})
}
