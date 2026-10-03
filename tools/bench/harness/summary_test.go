package harness

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeExport writes a k6 --summary-export document with one sub-metric set
// per operation, the way the entry script's thresholds make k6 report them.
func writeExport(t *testing.T, path string, ops map[string]map[string]float64) {
	t.Helper()
	metrics := map[string]map[string]float64{
		"http_req_duration": {"med": 99, "p(95)": 99, "p(99)": 99}, // the unscoped parent, ignored
	}
	for op, v := range ops {
		metrics["http_reqs{op:"+op+"}"] = map[string]float64{"count": v["count"], "rate": v["rate"]}
		metrics["http_req_failed{op:"+op+"}"] = map[string]float64{"passes": v["failed"], "fails": v["count"] - v["failed"]}
		for _, m := range []string{"http_req_duration", "http_req_blocked", "http_req_connecting", "http_req_sending", "http_req_waiting", "http_req_receiving"} {
			metrics[m+"{op:"+op+"}"] = map[string]float64{"med": v["med"], "p(95)": v["p95"], "p(99)": v["p99"]}
		}
	}
	b, err := json.Marshal(map[string]any{"metrics": metrics, "root_group": map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSummarizeMergesRunsPerOperation(t *testing.T) {
	dir := t.TempDir()
	writeExport(t, filepath.Join(dir, "login-5.json"), map[string]map[string]float64{
		"create_flow":     {"count": 282, "rate": 56.4, "failed": 0, "med": 3.97, "p95": 23.12, "p99": 31.07},
		"submit_password": {"count": 282, "rate": 56.4, "failed": 2, "med": 74.18, "p95": 91.34, "p99": 106.97},
	})
	writeExport(t, filepath.Join(dir, "getUser-1.json"), map[string]map[string]float64{
		"get_user": {"count": 5578, "rate": 1117, "failed": 0, "med": 0.64, "p95": 1.57, "p99": 3.28},
	})
	meta := SweepMeta{Runs: []RunMeta{
		{Scenario: "login", VUs: 5, Export: "login-5.json"},
		{Scenario: "getUser", VUs: 1, Export: "getUser-1.json"},
	}}

	rows, err := Summarize(dir, meta)
	if err != nil {
		t.Fatal(err)
	}
	want := []Row{
		{Scenario: "getUser", VUs: 1, Op: "get_user", N: 5578, RPS: 1117, Failed: 0, Duration: Quantiles{0.64, 1.57, 3.28}},
		{Scenario: "login", VUs: 5, Op: "create_flow", N: 282, RPS: 56.4, Failed: 0, Duration: Quantiles{3.97, 23.12, 31.07}},
		{Scenario: "login", VUs: 5, Op: "submit_password", N: 282, RPS: 56.4, Failed: 2, Duration: Quantiles{74.18, 91.34, 106.97}},
	}
	if len(rows) != len(want) {
		t.Fatalf("rows = %d, want %d: %+v", len(rows), len(want), rows)
	}
	for i := range want {
		got := rows[i]
		w := want[i]
		if got.Scenario != w.Scenario || got.VUs != w.VUs || got.Op != w.Op || got.N != w.N || got.RPS != w.RPS || got.Failed != w.Failed || got.Duration != w.Duration {
			t.Errorf("row %d = %+v, want %+v", i, got, w)
		}
		if got.Waiting != w.Duration {
			t.Errorf("row %d phases not read: %+v", i, got)
		}
	}
}

func TestSummarizeSkipsOperationsWithoutRequests(t *testing.T) {
	dir := t.TempDir()
	b, _ := json.Marshal(map[string]any{"metrics": map[string]any{
		"http_req_duration{op:ghost}": map[string]float64{"med": 1},
		// Declared by the script's thresholds, never performed by this scenario.
		"http_reqs{op:idle}":         map[string]float64{"count": 0, "rate": 0},
		"http_req_duration{op:idle}": map[string]float64{"med": 0},
		"iterations":                 map[string]float64{"count": 3},
	}})
	if err := os.WriteFile(filepath.Join(dir, "x.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
	rows, err := Summarize(dir, SweepMeta{Runs: []RunMeta{{Scenario: "x", VUs: 1, Export: "x.json"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Errorf("rows = %+v, want none", rows)
	}
}

func TestMarkdownHasOneRowPerOperation(t *testing.T) {
	md := Markdown(SweepMeta{Commit: "abc"}, []Row{{Scenario: "login", Op: "create_flow", VUs: 1, N: 3}})
	if want := "| login | create_flow | 1 | 3 |"; !strings.Contains(md, want) {
		t.Errorf("markdown lacks %q:\n%s", want, md)
	}
}
