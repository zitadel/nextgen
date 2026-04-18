package embedded

import (
	"fmt"
	"net"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetPort_LocksAndReleasesPort(t *testing.T) {
	t.Parallel()

	port, closePort, err := getPort()
	require.NoError(t, err)
	require.NotZero(t, port)

	locked, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	require.Error(t, err)
	require.Nil(t, locked)

	closePort()

	released, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	require.NoError(t, err)
	require.NotNil(t, released)
	require.NoError(t, released.Close())
}
