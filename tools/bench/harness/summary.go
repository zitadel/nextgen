package harness

import (
	"bufio"
	"cmp"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Row is one operation of one run, summarised. Durations are milliseconds,
// as k6 reports them. Series is the number of distinct time series the whole
// run emitted — the tag-cardinality check: it must not grow with the dataset.
type Row struct {
	Scenario string  `json:"scenario"`
	VUs      int     `json:"vus"`
	Op       string  `json:"op"`
	N        int     `json:"n"`
	RPS      float64 `json:"rps"`
	Failed   int     `json:"failed"`
	Series   int     `json:"series"`

	Duration   Quantiles `json:"duration"`
	Blocked    Quantiles `json:"blocked"`
	Connecting Quantiles `json:"connecting"`
	Sending    Quantiles `json:"sending"`
	Waiting    Quantiles `json:"waiting"`
	Receiving  Quantiles `json:"receiving"`
}

// Quantiles of one metric over one operation.
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
	Samples  string `json:"samples"`
	Summary  string `json:"summary"`
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

// point is one line of k6's JSON output that carries a sample.
type point struct {
	Type   string `json:"type"`
	Metric string `json:"metric"`
	Data   struct {
		Time  time.Time         `json:"time"`
		Value float64           `json:"value"`
		Tags  map[string]string `json:"tags"`
	} `json:"data"`
}

// Summarize reads every run in meta and returns one Row per operation.
func Summarize(dir string, meta SweepMeta) ([]Row, error) {
	var rows []Row
	for _, run := range meta.Runs {
		r, err := summarizeRun(filepath.Join(dir, run.Samples), run)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", run.Samples, err)
		}
		rows = append(rows, r...)
	}
	slices.SortFunc(rows, func(a, b Row) int {
		return cmp.Or(cmp.Compare(a.Scenario, b.Scenario), cmp.Compare(a.Op, b.Op), cmp.Compare(a.VUs, b.VUs))
	})
	return rows, nil
}

func summarizeRun(path string, run RunMeta) ([]Row, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var r io.Reader = f
	if strings.HasSuffix(path, ".gz") {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return nil, err
		}
		defer gz.Close()
		r = gz
	}

	type key struct{ metric, op string }
	samples := map[key][]float64{}
	series := map[string]struct{}{}
	failed := map[string]int{}
	var first, last time.Time

	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var p point
		if err := json.Unmarshal(sc.Bytes(), &p); err != nil {
			return nil, err
		}
		if p.Type != "Point" {
			continue
		}
		series[seriesKey(p.Metric, p.Data.Tags)] = struct{}{}
		op := p.Data.Tags["op"]
		if op == "" {
			continue
		}
		samples[key{p.Metric, op}] = append(samples[key{p.Metric, op}], p.Data.Value)
		if first.IsZero() || p.Data.Time.Before(first) {
			first = p.Data.Time
		}
		if p.Data.Time.After(last) {
			last = p.Data.Time
		}
		if p.Metric == "http_req_failed" && p.Data.Value != 0 {
			failed[op]++
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}

	ops := map[string]struct{}{}
	for k := range samples {
		if k.metric == "http_req_duration" {
			ops[k.op] = struct{}{}
		}
	}
	span := last.Sub(first).Seconds()
	rows := make([]Row, 0, len(ops))
	for op := range ops {
		n := len(samples[key{"http_req_duration", op}])
		row := Row{Scenario: run.Scenario, VUs: run.VUs, Op: op, N: n, Failed: failed[op], Series: len(series)}
		if span > 0 {
			row.RPS = float64(n) / span
		}
		row.Duration = quantiles(samples[key{"http_req_duration", op}])
		row.Blocked = quantiles(samples[key{"http_req_blocked", op}])
		row.Connecting = quantiles(samples[key{"http_req_connecting", op}])
		row.Sending = quantiles(samples[key{"http_req_sending", op}])
		row.Waiting = quantiles(samples[key{"http_req_waiting", op}])
		row.Receiving = quantiles(samples[key{"http_req_receiving", op}])
		rows = append(rows, row)
	}
	return rows, nil
}

// seriesKey is what k6 itself considers one time series: the metric plus
// the exact tag set.
func seriesKey(metric string, tags map[string]string) string {
	keys := slices.Sorted(maps.Keys(tags))
	var b strings.Builder
	b.WriteString(metric)
	for _, k := range keys {
		b.WriteByte('|')
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(tags[k])
	}
	return b.String()
}

func quantiles(v []float64) Quantiles {
	if len(v) == 0 {
		return Quantiles{}
	}
	s := slices.Clone(v)
	slices.Sort(s)
	q := func(p float64) float64 {
		k := float64(len(s)-1) * p
		f := int(k)
		c := min(f+1, len(s)-1)
		return s[f] + (s[c]-s[f])*(k-float64(f))
	}
	return Quantiles{P50: q(0.5), P95: q(0.95), P99: q(0.99)}
}

// Markdown renders rows as the comparison table a sweep directory's
// summary.md carries.
func Markdown(meta SweepMeta, rows []Row) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Sweep %s\n\n", meta.StartedAt.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "commit `%s` · lane `%s` · host `%s` (%d CPUs) · %s · target `%s`\n\n", meta.Commit, meta.Lane, meta.Host, meta.CPUs, meta.K6Version, meta.Base)
	b.WriteString("Durations in ms. `series` is the number of distinct time series the run emitted.\n\n")
	b.WriteString("| scenario | op | vus | n | req/s | failed | series | dur p50 | dur p95 | dur p99 | blocked p95 | connecting p95 | sending p95 | waiting p95 | receiving p95 |\n")
	b.WriteString("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "| %s | %s | %d | %d | %.0f | %d | %d | %.2f | %.2f | %.2f | %.3f | %.3f | %.3f | %.2f | %.3f |\n",
			r.Scenario, r.Op, r.VUs, r.N, r.RPS, r.Failed, r.Series,
			r.Duration.P50, r.Duration.P95, r.Duration.P99,
			r.Blocked.P95, r.Connecting.P95, r.Sending.P95, r.Waiting.P95, r.Receiving.P95)
	}
	return b.String()
}
