package harness

import (
	"cmp"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// RequestMetrics are k6's built-in per-request metrics the summary reports
// per operation. The entry script declares a `metric{op:<id>}` sub-metric for
// each of them so k6's own end-of-test summary carries one line per
// operation; this list and Operations are what it declares them from.
var RequestMetrics = []string{
	"http_reqs",
	"http_req_duration",
	"http_req_blocked",
	"http_req_connecting",
	"http_req_sending",
	"http_req_waiting",
	"http_req_receiving",
	"http_req_failed",
}

// Row is one operation of one run, read from k6's summary export. Durations
// are milliseconds, as k6 reports them.
type Row struct {
	Scenario string  `json:"scenario"`
	VUs      int     `json:"vus"`
	Op       string  `json:"op"`
	N        int     `json:"n"`
	RPS      float64 `json:"rps"`
	Failed   int     `json:"failed"`

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
}

// SweepMeta is the run metadata #1096 asks every summary to carry.
type SweepMeta struct {
	Commit    string    `json:"commit"`
	Lane      string    `json:"lane"`
	Host      string    `json:"host"`
	CPUs      int       `json:"cpus"`
	K6Version string    `json:"k6_version"`
	StartedAt time.Time `json:"started_at"`
	Base      string    `json:"base"`
	Runs      []RunMeta `json:"runs"`
}

// summaryExport is the part of k6's --summary-export document the merge
// reads: metric name (a sub-metric is `name{tag:value}`) to its values.
type summaryExport struct {
	Metrics map[string]map[string]float64 `json:"metrics"`
}

var subMetric = regexp.MustCompile(`^(\w+)\{op:(\w+)\}$`)

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

	// metric → op → values
	byOp := map[string]map[string]map[string]float64{}
	for name, values := range export.Metrics {
		m := subMetric.FindStringSubmatch(name)
		if m == nil {
			continue
		}
		if byOp[m[2]] == nil {
			byOp[m[2]] = map[string]map[string]float64{}
		}
		byOp[m[2]][m[1]] = values
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
			Scenario:   run.Scenario,
			VUs:        run.VUs,
			Op:         op,
			N:          int(reqs["count"]),
			RPS:        reqs["rate"],
			Failed:     int(metrics["http_req_failed"]["passes"]),
			Duration:   quantiles(metrics["http_req_duration"]),
			Blocked:    quantiles(metrics["http_req_blocked"]),
			Connecting: quantiles(metrics["http_req_connecting"]),
			Sending:    quantiles(metrics["http_req_sending"]),
			Waiting:    quantiles(metrics["http_req_waiting"]),
			Receiving:  quantiles(metrics["http_req_receiving"]),
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
	b.WriteString("Durations in ms, as k6 reported them per operation.\n\n")
	b.WriteString("| scenario | op | vus | n | req/s | failed | dur p50 | dur p95 | dur p99 | blocked p95 | connecting p95 | sending p95 | waiting p95 | receiving p95 |\n")
	b.WriteString("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "| %s | %s | %d | %d | %.0f | %d | %.2f | %.2f | %.2f | %.3f | %.3f | %.3f | %.2f | %.3f |\n",
			r.Scenario, r.Op, r.VUs, r.N, r.RPS, r.Failed,
			r.Duration.P50, r.Duration.P95, r.Duration.P99,
			r.Blocked.P95, r.Connecting.P95, r.Sending.P95, r.Waiting.P95, r.Receiving.P95)
	}
	return b.String()
}
