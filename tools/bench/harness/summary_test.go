package harness

import (
	"compress/gzip"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeSamples writes k6-style JSON lines: n requests per op, each with the
// full http_req_* set, tagged the way the module tags them — and, for the
// cardinality check, with a url tag that is the op, never the path.
func writeSamples(t *testing.T, path string, ops map[string][]float64) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	enc := json.NewEncoder(gz)
	at := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	for op, durations := range ops {
		for i, d := range durations {
			at = at.Add(100 * time.Millisecond)
			tags := map[string]string{"op": op, "name": op, "url": op, "status": "200", "lane": "local"}
			for _, m := range []string{"http_reqs", "http_req_duration", "http_req_blocked", "http_req_connecting", "http_req_sending", "http_req_waiting", "http_req_receiving", "http_req_failed"} {
				v := d
				switch m {
				case "http_reqs":
					v = 1
				case "http_req_failed":
					v = 0
					if i == 0 && op == "submit_password" {
						v = 1
					}
				}
				if err := enc.Encode(map[string]any{
					"type": "Point", "metric": m,
					"data": map[string]any{"time": at, "value": v, "tags": tags},
				}); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestSummarize(t *testing.T) {
	dir := t.TempDir()
	writeSamples(t, filepath.Join(dir, "login-5.json.gz"), map[string][]float64{
		"create_flow":     {1, 2, 3, 4, 5, 6, 7, 8, 9, 10},
		"submit_password": {30, 40, 50},
	})
	meta := SweepMeta{Runs: []RunMeta{{Scenario: "login", VUs: 5, Samples: "login-5.json.gz"}}}

	rows, err := Summarize(dir, meta)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	cf := rows[0]
	if cf.Op != "create_flow" || cf.N != 10 || !near(cf.Duration.P50, 5.5) || !near(cf.Duration.P95, 9.55) {
		t.Errorf("create_flow row = %+v", cf)
	}
	sp := rows[1]
	if sp.Op != "submit_password" || sp.N != 3 || sp.Failed != 1 || !near(sp.Duration.P50, 40) {
		t.Errorf("submit_password row = %+v", sp)
	}
	// 2 ops × 8 metrics, every sample on the same bounded tag set.
	if cf.Series != 16 {
		t.Errorf("series = %d, want 16", cf.Series)
	}
}

// TestSeriesDoNotGrowWithDataset is the #1104 cardinality assertion at the
// summary level: ten times the requests, the same number of series.
func TestSeriesDoNotGrowWithDataset(t *testing.T) {
	dir := t.TempDir()
	small := make([]float64, 10)
	large := make([]float64, 100)
	for i := range large {
		large[i] = float64(i)
	}
	writeSamples(t, filepath.Join(dir, "a.json.gz"), map[string][]float64{"get_user": small})
	writeSamples(t, filepath.Join(dir, "b.json.gz"), map[string][]float64{"get_user": large})
	rows, err := Summarize(dir, SweepMeta{Runs: []RunMeta{
		{Scenario: "getUser", VUs: 1, Samples: "a.json.gz"},
		{Scenario: "getUser", VUs: 5, Samples: "b.json.gz"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].Series != rows[1].Series {
		t.Errorf("series grew with the dataset: %d → %d", rows[0].Series, rows[1].Series)
	}
}

func TestMarkdownHasOneRowPerOperation(t *testing.T) {
	md := Markdown(SweepMeta{Commit: "abc"}, []Row{{Scenario: "login", Op: "create_flow", VUs: 1, N: 3}})
	if want := "| login | create_flow | 1 | 3 |"; !strings.Contains(md, want) {
		t.Errorf("markdown lacks %q:\n%s", want, md)
	}
}

func near(got, want float64) bool { return math.Abs(got-want) < 1e-9 }
