package embedded

import (
	"bytes"
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
	logPath := filepath.Join(t.TempDir(), "postgres.log")
	var out bytes.Buffer

	tailer := startFileTailer(logPath, &out)
	require.NotNil(t, tailer)
	defer tailer.Stop()

	require.NoError(t, os.WriteFile(logPath, []byte("first\n"), 0o600))
	require.Eventually(t, func() bool {
		return strings.Contains(out.String(), "first\n")
	}, time.Second, 10*time.Millisecond)

	file, err := os.OpenFile(logPath, os.O_WRONLY|os.O_APPEND, 0o600)
	require.NoError(t, err)
	_, err = file.WriteString("second\n")
	require.NoError(t, err)
	require.NoError(t, file.Close())
	require.Eventually(t, func() bool {
		return strings.Contains(out.String(), "second\n")
	}, time.Second, 10*time.Millisecond)
}
