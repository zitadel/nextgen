package securityheaders_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/securityheaders"
)

func TestMiddlewareSetsTheHeadersBeforeTheHandler(t *testing.T) {
	t.Parallel()
	var seen http.Header
	handler := securityheaders.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		seen = w.Header().Clone()
		// A page replaces the policy with its own.
		w.Header().Set(securityheaders.PolicyHeader, "script-src 'self'")
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/users", nil))

	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "strict-origin-when-cross-origin", rec.Header().Get("Referrer-Policy"))
	assert.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	assert.Equal(t, "camera=(), microphone=(), geolocation=()", seen.Get("Permissions-Policy"))
	assert.Equal(t, seen.Get("Permissions-Policy"), rec.Header().Get("Permissions-Policy"))
	assert.Equal(t, "default-src 'none'; frame-ancestors 'none'", seen.Get(securityheaders.PolicyHeader))
	assert.Equal(t, "script-src 'self'", rec.Header().Get(securityheaders.PolicyHeader))
}

func TestInlineScriptHashes(t *testing.T) {
	t.Parallel()
	page := `<head>
<script>a()</script>
<script type="module" src="/assets/index.js"></script>
<SCRIPT type="text/javascript">
  b()
</SCRIPT >
<script src=/x.js></script>
</head>`

	assert.Equal(t, []string{
		securityheaders.Hash("a()"),
		securityheaders.Hash("\n  b()\n"),
	}, securityheaders.InlineScriptHashes(page))
	// The hash a browser compares: base64 of the SHA-256 of the exact text.
	assert.Equal(t, "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='", securityheaders.Hash(""))
}

func TestPolicySkipsEmptyDirectives(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "default-src 'none'; frame-ancestors 'none'",
		securityheaders.Policy("default-src 'none'", "", " frame-ancestors 'none' "))
}

func TestReportLogsAViolationWithoutItsQuery(t *testing.T) {
	t.Parallel()
	var logs bytes.Buffer
	ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))
	report := `{"csp-report":{
		"document-uri":"https://preview.zitadel.com/console/login?session_token=secret#frag",
		"violated-directive":"script-src-elem",
		"effective-directive":"script-src-elem",
		"blocked-uri":"inline",
		"source-file":"https://preview.zitadel.com/console/login?session_token=secret",
		"line-number":12,
		"column-number":3,
		"disposition":"report",
		"original-policy":"script-src 'self'"
	}}`

	rec := post(t, ctx, "application/csp-report", report)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	var line map[string]any
	require.NoError(t, json.Unmarshal(logs.Bytes(), &line))
	assert.Equal(t, "WARN", line["level"])
	assert.Equal(t, "content security policy violation", line["msg"])
	assert.Equal(t, "https://preview.zitadel.com/console/login", line["document"])
	assert.Equal(t, "script-src-elem", line["directive"])
	assert.Equal(t, "inline", line["blocked"])
	assert.Equal(t, "https://preview.zitadel.com/console/login", line["source"])
	assert.InDelta(t, 12, line["line"], 0)
	assert.Equal(t, "report", line["disposition"])
	assert.NotContains(t, logs.String(), "secret")
}

func TestReportAnswers204ToWhatItCannotUse(t *testing.T) {
	t.Parallel()
	for name, body := range map[string]string{
		"not JSON":     "{",
		"no violation": `{"csp-report":{}}`,
		"an extension's code": `{"csp-report":{"effective-directive":"script-src-elem",` +
			`"blocked-uri":"chrome-extension://abc/inject.js"}}`,
		"too large": `{"csp-report":{"effective-directive":"` + strings.Repeat("x", 32<<10) + `"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var logs bytes.Buffer
			ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))

			rec := post(t, ctx, "application/csp-report", body)

			assert.Equal(t, http.StatusNoContent, rec.Code)
			assert.Empty(t, logs.String())
		})
	}
}

func TestReportTakesOnlyPosts(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	securityheaders.Report().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, securityheaders.ReportPath, nil))
	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	assert.Equal(t, http.MethodPost, rec.Header().Get("Allow"))
}

func post(t *testing.T, ctx context.Context, contentType, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequestWithContext(ctx, http.MethodPost, securityheaders.ReportPath, strings.NewReader(body))
	r.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	securityheaders.Report().ServeHTTP(rec, r)
	return rec
}
