package harness

import (
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"go.k6.io/k6/v2/metrics"
)

// MetricErrors is the module's own counter of failed operations, tagged
// op, lane, status_class and code.
const MetricErrors = "nextgen_errors"

// The session cache's metrics. They are not tagged with an operation: the
// cache is process-wide, and its cost must stay out of every operation trend.
const (
	// MetricSessionMiss counts Gets on the measured path that found no usable
	// session. Any non-zero value means a VU paid for a login inside a
	// measured iteration and the window is not valid.
	MetricSessionMiss = "nextgen_session_cache_miss"
	// MetricSessionRefresh is the cost of each login the cache paid, in ms,
	// tagged result=ok|error and path=background|miss.
	MetricSessionRefresh = "nextgen_session_refresh_duration"
	// MetricSessionRefreshes counts the logins the cache paid, tagged
	// result=ok|error and path=background|miss, so the summary can say how
	// many happened and how many failed.
	MetricSessionRefreshes = "nextgen_session_refreshes"
)

// SessionMetrics are the cache's metrics as the entry script declares them,
// sub-metrics included, so k6's own summary reports each.
var SessionMetrics = []string{
	MetricSessionMiss,
	MetricSessionRefresh,
	MetricSessionRefreshes,
	MetricSessionRefreshes + "{result:error}",
}

// SessionStats is what a run's session cache did, read from k6's summary.
type SessionStats struct {
	// Misses is how many measured-path Gets found no usable session. A
	// non-zero value invalidates the run's window.
	Misses int `json:"misses"`
	// Refreshes counts the logins the cache paid and RefreshErrors the ones
	// that failed.
	Refreshes     int `json:"refreshes"`
	RefreshErrors int `json:"refresh_errors"`
	// RefreshP95 is the 95th percentile cost of one login, in ms.
	RefreshP95 float64 `json:"refresh_p95_ms"`
}

// Valid reports whether the window can be reported: no VU paid for a login
// inside a measured iteration.
func (s SessionStats) Valid() bool { return s.Misses == 0 }

// Used reports whether the run exercised the cache at all.
func (s SessionStats) Used() bool { return s.Refreshes > 0 || s.Misses > 0 }

// ReadSessionStats reads a run's session cache numbers from k6's summary
// export.
func ReadSessionStats(path string) (SessionStats, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return SessionStats{}, err
	}
	var export summaryExport
	if err := json.Unmarshal(b, &export); err != nil {
		return SessionStats{}, err
	}
	return SessionStats{
		Misses:        int(numbers(export.Metrics[MetricSessionMiss])["count"]),
		Refreshes:     int(numbers(export.Metrics[MetricSessionRefreshes])["count"]),
		RefreshErrors: int(numbers(export.Metrics[MetricSessionRefreshes+"{result:error}"])["count"]),
		RefreshP95:    numbers(export.Metrics[MetricSessionRefresh])["p(95)"],
	}, nil
}

// SummaryMetrics are the metrics the summary reports per operation: k6's
// built-in per-request metrics and the module's error counter. The entry
// script declares a `metric{op:<id>}` sub-metric for each of them so k6's
// own end-of-test summary carries one line per operation; Submetrics lists
// what it declares.
var SummaryMetrics = []string{
	"http_reqs",
	"http_req_duration",
	"http_req_blocked",
	"http_req_connecting",
	"http_req_sending",
	"http_req_waiting",
	"http_req_receiving",
	"http_req_failed",
	MetricErrors,
}

// Row is one operation of one run, read from k6's summary export. Durations
// are milliseconds, as k6 reports them.
type Row struct {
	Scenario string  `json:"scenario"`
	VUs      int     `json:"vus"`
	Op       string  `json:"op"`
	N        int     `json:"n"`
	RPS      float64 `json:"rps"`
	// Failed counts non-2xx/3xx responses (k6's http_req_failed); Errors
	// counts failed operations as the module classified them, which includes
	// a 200 that re-served a step with an error key. ErrorsByStatus and
	// ErrorsByCode break Errors down by the status class and the error code
	// the module tagged, from the sub-metrics the script declares for them.
	Failed         int            `json:"failed"`
	Errors         int            `json:"errors"`
	ErrorsByStatus map[string]int `json:"errors_by_status,omitempty"`
	ErrorsByCode   map[string]int `json:"errors_by_code,omitempty"`

	Duration   Quantiles `json:"duration"`
	Blocked    Quantiles `json:"blocked"`
	Connecting Quantiles `json:"connecting"`
	Sending    Quantiles `json:"sending"`
	Waiting    Quantiles `json:"waiting"`
	Receiving  Quantiles `json:"receiving"`
}

// Quantiles of one metric over one operation, as k6 computed them.
type Quantiles struct {
	P50 float64 `json:"p50"`
	P95 float64 `json:"p95"`
	P99 float64 `json:"p99"`
}

// RunMeta describes one k6 run inside a sweep. The sweep writes a list of
// these as runs.json so the summariser does not have to parse file names.
type RunMeta struct {
	Scenario string `json:"scenario"`
	VUs      int    `json:"vus"`
	Duration string `json:"duration"`
	// Export is k6's end-of-test summary (--summary-export) for the run.
	Export string `json:"export"`
	// Console is what k6 printed.
	Console string `json:"console"`
	// Samples is the raw per-sample output, present only when the sweep ran
	// with --raw.
	Samples string `json:"samples,omitempty"`
	// Sessions is what the session cache did in the run, present when the
	// run used it.
	Sessions *SessionStats `json:"sessions,omitzero"`
}

// Invalid lists the runs whose window cannot be reported, with the reason.
func (m SweepMeta) Invalid() []string {
	var out []string
	for _, r := range m.Runs {
		if r.Sessions != nil && !r.Sessions.Valid() {
			out = append(out, fmt.Sprintf("%s at %d VUs: %d measured-path session cache misses", r.Scenario, r.VUs, r.Sessions.Misses))
		}
	}
	return out
}

// SweepMeta is the run metadata #1096 asks every summary to carry.
type SweepMeta struct {
	Commit string `json:"commit"`
	// RequestTimeout is the per-request timeout the module applied; k6 owns
	// the connection pool, so that is the one transport setting to record.
	RequestTimeout string    `json:"request_timeout"`
	Lane           string    `json:"lane"`
	Host           string    `json:"host"`
	CPUs           int       `json:"cpus"`
	K6Version      string    `json:"k6_version"`
	StartedAt      time.Time `json:"started_at"`
	Base           string    `json:"base"`
	// Doctor is the check of the target taken before the first run: what it
	// was, and which of that was observed rather than declared.
	Doctor *DoctorReport `json:"doctor,omitzero"`
	// SessionSettings are the session cache choices the sweep ran with, as
	// the environment names them; empty means the defaults.
	SessionSettings map[string]string `json:"session_settings,omitempty"`
	Runs            []RunMeta         `json:"runs"`
}

// summaryExport is the part of k6's --summary-export document the merge
// reads: metric name (a sub-metric is `name{tag:value,...}`) to its fields.
// A metric with a non-empty threshold carries a nested `thresholds` object
// next to its numbers, so the fields are read raw and only numbers kept.
type summaryExport struct {
	Metrics map[string]map[string]json.RawMessage `json:"metrics"`
}

// Submetrics returns every sub-metric name the entry script declares and
// the summary reads: each summary metric per operation, and the module's
// error counter further per status class and per error code, from the
// bounded vocabularies the module tags with. Declaring them is what makes
// k6 keep and export the breakdown; nothing here is aggregated in Go.
func Submetrics() []string {
	var out []string
	for _, op := range Operations {
		for _, m := range SummaryMetrics {
			out = append(out, fmt.Sprintf("%s{op:%s}", m, op))
		}
		for _, class := range StatusClasses {
			out = append(out, fmt.Sprintf("%s{op:%s,status_class:%s}", MetricErrors, op, class))
		}
		for _, code := range ErrorCodes(op) {
			out = append(out, fmt.Sprintf("%s{op:%s,code:%s}", MetricErrors, op, code))
		}
	}
	return out
}

// numbers keeps the numeric fields of an exported metric.
func numbers(raw map[string]json.RawMessage) map[string]float64 {
	out := make(map[string]float64, len(raw))
	for k, v := range raw {
		var f float64
		if err := json.Unmarshal(v, &f); err == nil {
			out[k] = f
		}
	}
	return out
}

// parseSubmetric splits `name{k:v,...}` the way k6 names a sub-metric. The
// second result is false for a plain metric or anything else.
func parseSubmetric(name string) (string, map[string]string, bool) {
	metric, kvs, err := metrics.ParseMetricName(name)
	if err != nil || len(kvs) == 0 {
		return "", nil, false
	}
	tags := make(map[string]string, len(kvs))
	for _, kv := range kvs {
		k, v, ok := strings.Cut(kv, ":")
		if !ok {
			return "", nil, false
		}
		tags[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return metric, tags, true
}

// Summarize merges the runs of a sweep into one Row per operation per run.
// Every number comes from k6's own summary; nothing is re-aggregated here.
func Summarize(dir string, meta SweepMeta) ([]Row, error) {
	var rows []Row
	for _, run := range meta.Runs {
		r, err := summarizeRun(filepath.Join(dir, run.Export), run)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", run.Export, err)
		}
		rows = append(rows, r...)
	}
	slices.SortFunc(rows, func(a, b Row) int {
		return cmp.Or(cmp.Compare(a.Scenario, b.Scenario), cmp.Compare(a.Op, b.Op), cmp.Compare(a.VUs, b.VUs))
	})
	return rows, nil
}

func summarizeRun(path string, run RunMeta) ([]Row, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var export summaryExport
	if err := json.Unmarshal(b, &export); err != nil {
		return nil, err
	}

	// op → metric → values, for the per-operation sub-metrics; the error
	// breakdowns are collected by op alongside.
	byOp := map[string]map[string]map[string]float64{}
	errorsByStatus := map[string]map[string]int{}
	errorsByCode := map[string]map[string]int{}
	for name, raw := range export.Metrics {
		metric, tags, ok := parseSubmetric(name)
		if !ok || tags["op"] == "" {
			continue
		}
		op := tags["op"]
		values := numbers(raw)
		switch {
		case len(tags) == 1:
			if byOp[op] == nil {
				byOp[op] = map[string]map[string]float64{}
			}
			byOp[op][metric] = values
		case metric == MetricErrors && len(tags) == 2 && values["count"] > 0:
			if class, ok := tags["status_class"]; ok {
				if errorsByStatus[op] == nil {
					errorsByStatus[op] = map[string]int{}
				}
				errorsByStatus[op][class] = int(values["count"])
			}
			if code, ok := tags["code"]; ok {
				if errorsByCode[op] == nil {
					errorsByCode[op] = map[string]int{}
				}
				errorsByCode[op][code] = int(values["count"])
			}
		}
	}

	rows := make([]Row, 0, len(byOp))
	for op, metrics := range byOp {
		// k6 reports every declared sub-metric, including the operations a
		// scenario never performed; those have no requests and no row.
		reqs := metrics["http_reqs"]
		if reqs == nil || reqs["count"] == 0 {
			continue
		}
		rows = append(rows, Row{
			Scenario:       run.Scenario,
			VUs:            run.VUs,
			Op:             op,
			N:              int(reqs["count"]),
			RPS:            reqs["rate"],
			Failed:         int(metrics["http_req_failed"]["passes"]),
			Errors:         int(metrics[MetricErrors]["count"]),
			ErrorsByStatus: errorsByStatus[op],
			ErrorsByCode:   errorsByCode[op],
			Duration:       quantiles(metrics["http_req_duration"]),
			Blocked:        quantiles(metrics["http_req_blocked"]),
			Connecting:     quantiles(metrics["http_req_connecting"]),
			Sending:        quantiles(metrics["http_req_sending"]),
			Waiting:        quantiles(metrics["http_req_waiting"]),
			Receiving:      quantiles(metrics["http_req_receiving"]),
		})
	}
	return rows, nil
}

// quantiles reads the trend stats the sweep asks k6 for
// (--summary-trend-stats): med stands in for p50.
func quantiles(values map[string]float64) Quantiles {
	return Quantiles{P50: values["med"], P95: values["p(95)"], P99: values["p(99)"]}
}

// Markdown renders rows as the comparison table a sweep directory's
// summary.md carries.
func Markdown(meta SweepMeta, rows []Row) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Sweep %s\n\n", meta.StartedAt.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "commit `%s` · lane `%s` · host `%s` (%d CPUs) · %s · target `%s`\n\n", meta.Commit, meta.Lane, meta.Host, meta.CPUs, meta.K6Version, meta.Base)
	if meta.Doctor != nil {
		b.WriteString("Target, as checked before the first run:\n\n```\n")
		b.WriteString(meta.Doctor.Format())
		b.WriteString("```\n\n")
	}
	b.WriteString("Durations in ms, as k6 reported them per operation. Errors are failed operations as the module classified them, broken down by status class and error code.\n\n")
	b.WriteString("| scenario | op | vus | n | req/s | failed | errors | error breakdown | dur p50 | dur p95 | dur p99 | blocked p95 | connecting p95 | sending p95 | waiting p95 | receiving p95 |\n")
	b.WriteString("|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "| %s | %s | %d | %d | %.0f | %d | %d | %s | %.2f | %.2f | %.2f | %.3f | %.3f | %.3f | %.2f | %.3f |\n",
			r.Scenario, r.Op, r.VUs, r.N, r.RPS, r.Failed, r.Errors, errorBreakdown(r),
			r.Duration.P50, r.Duration.P95, r.Duration.P99,
			r.Blocked.P95, r.Connecting.P95, r.Sending.P95, r.Waiting.P95, r.Receiving.P95)
	}
	if used := sessionRuns(meta); len(used) > 0 {
		b.WriteString("\nSession cache. Refresh cost is the logins the cache paid on its own path; it is not in any operation above. A run with measured-path misses is invalid: a VU paid for a login inside a measured iteration.\n\n")
		b.WriteString("| scenario | vus | refreshes | refresh errors | refresh p95 | misses | window |\n|---|---:|---:|---:|---:|---:|---|\n")
		for _, r := range used {
			window := "valid"
			if !r.Sessions.Valid() {
				window = "INVALID"
			}
			fmt.Fprintf(&b, "| %s | %d | %d | %d | %.2f | %d | %s |\n", r.Scenario, r.VUs, r.Sessions.Refreshes, r.Sessions.RefreshErrors, r.Sessions.RefreshP95, r.Sessions.Misses, window)
		}
	}
	return b.String()
}

// errorBreakdown renders a row's errors by status class and code, in a
// stable order, or "-" when there were none.
func errorBreakdown(r Row) string {
	if r.Errors == 0 {
		return "-"
	}
	var parts []string
	for _, m := range []map[string]int{r.ErrorsByStatus, r.ErrorsByCode} {
		for _, k := range slices.Sorted(maps.Keys(m)) {
			parts = append(parts, fmt.Sprintf("%s=%d", k, m[k]))
		}
	}
	return strings.Join(parts, " ")
}

func sessionRuns(meta SweepMeta) []RunMeta {
	var out []RunMeta
	for _, r := range meta.Runs {
		if r.Sessions != nil && r.Sessions.Used() {
			out = append(out, r)
		}
	}
	return out
}
