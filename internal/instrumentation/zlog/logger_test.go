// Demonstrates that WithStream's WithGroup nesting prevents sloggcp from
// recognizing top-level error reports. Intended as evidence for a bug report.
package zlog

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"

	slogctx "github.com/veqryn/slog-context"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog/replacers"
	"github.com/zitadel/sloggcp"
)

func TestWithStream_preventsTopLevelErrorReporting(t *testing.T) {
	const (
		logMsg  = "operation failed"
		errText = "something went wrong"
	)
	testErr := errors.New(errText)
	streamName := StreamRequest.String()

	t.Run("baseline_no_group", func(t *testing.T) {
		var buf bytes.Buffer
		logger := NewLogger(sloggcp.NewErrorReportingHandler(&buf, &slog.HandlerOptions{
			ReplaceAttr: replacers.ReplaceErrKeys,
		}))

		logger.Error(logMsg, slogctx.Err(testErr))
		t.Log(buf.String())

		got := decodeLog(t, buf.Bytes())
		if got["@type"] != sloggcp.ErrorReportTypeValue {
			t.Errorf("@type = %v, want %q", got["@type"], sloggcp.ErrorReportTypeValue)
		}
		if got["error"] != errText {
			t.Errorf("error = %v, want %q", got["error"], errText)
		}
		if got["message"] != errText {
			t.Errorf("message = %v, want %q", got["message"], errText)
		}
	})

	t.Run("with_stream_group", func(t *testing.T) {
		var buf bytes.Buffer
		logger := NewLogger(sloggcp.NewErrorReportingHandler(&buf, &slog.HandlerOptions{
			ReplaceAttr: replacers.ReplaceErrKeys,
		}))
		streamLogger := WithStream(logger, StreamRequest)

		streamLogger.Error(logMsg, slogctx.Err(testErr))
		t.Log(buf.String())

		got := decodeLog(t, buf.Bytes())
		if _, ok := got["@type"]; ok {
			t.Errorf("unexpected top-level @type: %v", got["@type"])
		}
		if _, ok := got["error"]; ok {
			t.Errorf("unexpected top-level error: %v", got["error"])
		}
		if got["message"] != logMsg {
			t.Errorf("message = %v, want %q (error report promotion did not run)", got["message"], logMsg)
		}

		streamGroup, ok := got[streamName].(map[string]any)
		if !ok {
			t.Fatalf("missing nested stream group %q: got = %#v", streamName, got)
		}
		// ReplaceErrKeys only runs at top level, so the nested key stays "err".
		if streamGroup["err"] != errText {
			t.Errorf("nested %q.err = %v, want %q", streamName, streamGroup["err"], errText)
		}
		if _, ok := streamGroup["error"]; ok {
			t.Errorf("unexpected nested %q.error (err was not promoted): %v", streamName, streamGroup["error"])
		}
	})
}

func decodeLog(t *testing.T, data []byte) map[string]any {
	t.Helper()

	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("json.Unmarshal() error = %v\nraw: %s", err, data)
	}
	return got
}
