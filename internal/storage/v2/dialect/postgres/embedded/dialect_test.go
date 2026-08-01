package embedded

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGetPortReleasesReservedTCP4Port(t *testing.T) {
	port, releasePort, err := getPort()
	if err != nil {
		t.Fatalf("get port: %v", err)
	}

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	listener, err := net.Listen("tcp4", addr)
	if err == nil {
		_ = listener.Close()
		_ = releasePort()
		t.Fatalf("port %d was not reserved before release", port)
	}

	if err = releasePort(); err != nil {
		t.Fatalf("release port: %v", err)
	}

	listener, err = net.Listen("tcp4", addr)
	if err != nil {
		t.Fatalf("port %d was not released: %v", port, err)
	}
	_ = listener.Close()
}

// The port must sit below the OS ephemeral floors (Linux 32768, macOS 49152)
// so outbound loopback connections can never take it between release and the
// deferred postmaster bind — see the portBlockStart comment.
func TestGetPortStaysOutsideEphemeralRange(t *testing.T) {
	// Pin the block itself, not just membership: moving it above the Linux
	// floor would silently reintroduce the steal race this fix removed.
	require.GreaterOrEqual(t, portBlockStart, 1024)
	require.Less(t, portBlockStart+portBlockSize-1, 32768)

	for range 32 {
		port, releasePort, err := getPort()
		require.NoError(t, err)
		require.NoError(t, releasePort())
		require.GreaterOrEqual(t, int(port), portBlockStart)
		require.Less(t, int(port), portBlockStart+portBlockSize)
	}
}

func TestGetPortSkipsBoundPorts(t *testing.T) {
	port, releasePort, err := getPortFrom(0)
	require.NoError(t, err)
	defer func() { _ = releasePort() }()

	// Scanning from the same offset again must skip the port the first call
	// still holds and settle on a later candidate.
	secondPort, releaseSecondPort, err := getPortFrom(0)
	require.NoError(t, err)
	defer func() { _ = releaseSecondPort() }()

	require.Greater(t, secondPort, port)
}

func TestPostgresLogStartParametersUseConfiguredLogPath(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "postgres.log")

	params := postgresLogStartParameters(logPath)

	require.Equal(t, "stderr", params["log_destination"])
	require.Equal(t, "on", params["logging_collector"])
	require.Equal(t, filepath.Dir(logPath), params["log_directory"])
	require.Equal(t, filepath.Base(logPath), params["log_filename"])
	require.Equal(t, "on", params["log_truncate_on_rotation"])
}

func TestFileTailerStreamsAppendedLogLines(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "postgres.log")
	outPath := filepath.Join(dir, "tailer.out")
	out, err := os.OpenFile(outPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, out.Close())
	})

	tailer := startFileTailer(logPath, out)
	require.NotNil(t, tailer)
	t.Cleanup(tailer.Stop)

	require.NoError(t, os.WriteFile(logPath, []byte("first\n"), 0o600))
	require.Eventually(t, func() bool {
		return fileContains(t, outPath, "first\n")
	}, time.Second, 10*time.Millisecond)

	file, err := os.OpenFile(logPath, os.O_WRONLY|os.O_APPEND, 0o600)
	require.NoError(t, err)
	_, err = file.WriteString("second\n")
	require.NoError(t, err)
	require.NoError(t, file.Close())
	require.Eventually(t, func() bool {
		return fileContains(t, outPath, "second\n")
	}, time.Second, 10*time.Millisecond)
}

func fileContains(t *testing.T, path, needle string) bool {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	return strings.Contains(string(raw), needle)
}
