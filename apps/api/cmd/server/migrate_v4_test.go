package server

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/migratev4"
)

func TestMigrateV4RefusesOnlineModesBeforeConnecting(t *testing.T) {
	for _, args := range [][]string{{"run"}, {"run", "--v4-stopped"}, {"run", "--follow=1s"}} {
		config := filepath.Join(t.TempDir(), "does-not-exist.yaml")
		cmd := newMigrateV4Command(&config)
		cmd.SetArgs(args)
		err := cmd.Execute()
		require.Error(t, err)
		require.NotContains(t, err.Error(), "does-not-exist", "reject unsafe options before loading config or connecting")
	}
}

func TestMigrateV4JSONReport(t *testing.T) {
	config := ""
	cmd := newMigrateV4Command(&config)
	require.NoError(t, cmd.ParseFlags([]string{"--json"}))
	value, err := cmd.PersistentFlags().GetString("json")
	require.NoError(t, err)
	require.Equal(t, "-", value)
	var out bytes.Buffer
	report := &migratev4.Report{Command: "assess", Issues: []migratev4.Issue{{Code: "password_change_required", Severity: migratev4.SeverityConflict}}}
	require.NoError(t, writeReport(&out, &migrateV4Flags{jsonOut: "-"}, report))
	var got migratev4.Report
	require.NoError(t, json.Unmarshal(out.Bytes(), &got), "stdout contains exactly one JSON object")
	require.False(t, got.ReadyForCutover)
	require.Equal(t, report.Issues, got.Issues)
	path := filepath.Join(t.TempDir(), "report.json")
	require.NoError(t, os.WriteFile(path, nil, 0o644))
	require.NoError(t, writeReport(&out, &migrateV4Flags{jsonOut: path}, report))
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}
