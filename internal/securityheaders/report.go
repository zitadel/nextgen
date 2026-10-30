package securityheaders

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/errlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// maxReportBytes bounds a report: a browser's is well under 4 KiB, the policy
// it quotes included.
const maxReportBytes = 16 << 10

// maxFieldLength bounds each field the log line repeats from a report.
const maxFieldLength = 256

// violation is the report-uri directive's report, application/csp-report.
type violation struct {
	DocumentURI        string `json:"document-uri"`
	EffectiveDirective string `json:"effective-directive"`
	ViolatedDirective  string `json:"violated-directive"`
	BlockedURI         string `json:"blocked-uri"`
	SourceFile         string `json:"source-file"`
	LineNumber         int    `json:"line-number"`
	ColumnNumber       int    `json:"column-number"`
	Disposition        string `json:"disposition"`
}

// extensionSchemes are where a browser extension's code comes from: it runs
// in the page, so the page's policy reports it, but it is none of ours.
var extensionSchemes = []string{"chrome-extension:", "moz-extension:", "safari-web-extension:"}

// Report logs the violations browsers post to ReportPath, one warning each,
// so they show in the server's logs beside the requests. Anyone can post
// here: a report is a claim, and the log line repeats only bounded fields of
// it, its URLs cut before a query or fragment that may hold a sign-in flow's
// state. It answers 204 to every post, read or not, so a page learns nothing
// from the answer.
func Report() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			errlog.Log(r.Context(), domain.ErrRequestMethodNotAllowed())
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		var report struct {
			Violation violation `json:"csp-report"`
		}
		err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxReportBytes)).Decode(&report)
		if err != nil {
			// Refused, though the answer does not say so.
			errlog.Log(r.Context(), domain.ErrRequestInvalid().WithParent(err))
		}
		if v := report.Violation; err == nil && v.EffectiveDirective+v.ViolatedDirective != "" && !v.fromExtension() {
			zlog.Warn(r.Context(), "content security policy violation",
				slog.String("document", withoutQuery(v.DocumentURI)),
				slog.String("directive", bounded(firstOf(v.EffectiveDirective, v.ViolatedDirective))),
				slog.String("blocked", withoutQuery(v.BlockedURI)),
				slog.String("source", withoutQuery(v.SourceFile)),
				slog.Int("line", v.LineNumber),
				slog.Int("column", v.ColumnNumber),
				slog.String("disposition", bounded(v.Disposition)),
			)
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func (v violation) fromExtension() bool {
	for _, scheme := range extensionSchemes {
		if strings.HasPrefix(v.BlockedURI, scheme) || strings.HasPrefix(v.SourceFile, scheme) {
			return true
		}
	}
	return false
}

// withoutQuery cuts a URL at its query or fragment. A report's URL may also
// be a keyword ("inline", "eval"), which it leaves as it is.
func withoutQuery(raw string) string {
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	return bounded(raw)
}

func firstOf(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func bounded(value string) string {
	if len(value) <= maxFieldLength {
		return value
	}
	return strings.ToValidUTF8(value[:maxFieldLength], "") + "…"
}
