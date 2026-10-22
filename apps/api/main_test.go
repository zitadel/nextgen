package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMainReportsAFailedStart pins #1409 at the process boundary: a start
// against a data dir that was never migrated has to exit 1 and say why at
// ERROR, with instrumentation.log.level at warn. It used to exit 1 with no
// record of the failure, because log.Fatal writes through the log package,
// which slog.SetDefault bridges into the configured logger at INFO.
//
// main ends in os.Exit, so the test re-runs its own binary and lets that child
// call main; the config path in the environment is what tells the child apart.
func TestMainReportsAFailedStart(t *testing.T) {
	if configPath := os.Getenv("NEXTGEN_TEST_MAIN_CONFIG"); configPath != "" {
		os.Args = []string{os.Args[0], "--config", configPath}
		main()
		// Reached only when main returns instead of exiting, which the parent
		// then sees as exit status 0.
		return
	}

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(`
server:
  data_dir: `+t.TempDir()+`
platform:
  bootstrap_project: true
instrumentation:
  log:
    level: warn
`), 0o600))

	// Bounded so that a start which no longer fails is reported instead of
	// waited on until go test's own timeout.
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$")
	// Only the config file configures the child: NEXTGEN_* variables from the
	// developer's shell outrank it and would change the output asserted on.
	cmd.Env = slices.DeleteFunc(os.Environ(), func(kv string) bool {
		return strings.HasPrefix(kv, "NEXTGEN_")
	})
	cmd.Env = append(cmd.Env, "NEXTGEN_TEST_MAIN_CONFIG="+configPath)
	out, err := cmd.CombinedOutput()

	exitErr, ok := errors.AsType[*exec.ExitError](err)
	require.True(t, ok, "expected exit status 1, got err=%v with output:\n%s", err, out)
	assert.Equal(t, 1, exitErr.ExitCode(), "output:\n%s", out)
	// One record, all three fields: run's own "run error" record would satisfy
	// a bare level=ERROR check and leave a log.Fatal, or a WARN, in main
	// unnoticed.
	assert.Regexp(t, `level=ERROR source=\S+/main\.go:\d+ msg="exiting with error"`, string(out), "output:\n%s", out)
	assert.Contains(t, string(out), "failed to bootstrap platform project", "output:\n%s", out)
}
