package zlog_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// TestInfo_Source checks that the source of a zlog line is the function that
// called zlog.Info, not a frame inside zlog.
func TestInfo_Source(t *testing.T) {
	var buf bytes.Buffer
	logger := zlog.NewLogger(slog.NewJSONHandler(&buf, &slog.HandlerOptions{AddSource: true}))
	ctx := zlog.WithLoggingContext(context.Background(), logger)

	zlog.Info(ctx, "located")

	var line struct {
		Source struct {
			Function string `json:"function"`
			File     string `json:"file"`
		} `json:"source"`
	}
	require.NoError(t, json.Unmarshal(buf.Bytes(), &line))
	assert.Equal(t, "github.com/zitadel/nextgen/internal/instrumentation/zlog_test.TestInfo_Source", line.Source.Function)
	assert.Equal(t, "context_test.go", filepath.Base(line.Source.File))
}

func TestInfo_NoSource(t *testing.T) {
	var buf bytes.Buffer
	logger := zlog.NewLogger(slog.NewJSONHandler(&buf, &slog.HandlerOptions{AddSource: false}))
	ctx := zlog.WithLoggingContext(context.Background(), logger)

	zlog.Info(ctx, "located")

	var line map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &line))
	assert.NotContains(t, line, slog.SourceKey)
}
