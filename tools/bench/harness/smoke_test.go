package harness

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/zitadel/nextgen/tools/bench/scripts"
)

// TestRegistryAgreesWithTheScript: a registered scenario must have an
// exported function of its name in the entry script, and use only known
// operations. Without the first, the scenario would be registered and
// unrunnable; without the second, the smoke lane would expect samples nothing
// can produce.
func TestRegistryAgreesWithTheScript(t *testing.T) {
	exported := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^export function (\w+)\(`).FindAllStringSubmatch(string(scripts.Bench), -1) {
		exported[m[1]] = true
	}
	seen := map[string]bool{}
	for _, sc := range Scenarios {
		if seen[sc.Name] {
			t.Errorf("scenario %s registered twice", sc.Name)
		}
		seen[sc.Name] = true
		if !exported[sc.Name] {
			t.Errorf("scenario %s is registered but scripts/bench.js exports no function of that name", sc.Name)
		}
		if len(sc.Ops) == 0 {
			t.Errorf("scenario %s declares no operations", sc.Name)
		}
		for _, op := range sc.Ops {
			if !slices.Contains(Operations, op) {
				t.Errorf("scenario %s uses unknown operation %s", sc.Name, op)
			}
		}
	}
	// Every operation is used by some scenario; one that is not would never
	// be exercised by the lane.
	for _, op := range Operations {
		if !slices.ContainsFunc(Scenarios, func(s Scenario) bool { return slices.Contains(s.Ops, op) }) {
			t.Errorf("operation %s belongs to no scenario", op)
		}
	}
}

func TestParseScenarios(t *testing.T) {
	all, err := ParseScenarios("")
	if err != nil || !slices.Equal(all, ScenarioNames()) {
		t.Errorf("empty list = %v, %v; want every registered scenario", all, err)
	}
	one, err := ParseScenarios(" login , getUser ")
	if err != nil || !slices.Equal(one, []string{"login", "getUser"}) {
		t.Errorf("explicit list = %v, %v", one, err)
	}
	if _, err := ParseScenarios("login,nope"); err == nil || !strings.Contains(err.Error(), "nope") {
		t.Errorf("unknown scenario accepted: %v", err)
	}
}

// writeRun writes a k6 --summary-export document for a run in which the given
// operations each saw n requests.
func writeRun(t *testing.T, dir, name string, ops map[string]int, mutate func(map[string]map[string]float64)) string {
	t.Helper()
	metrics := map[string]map[string]float64{}
	for _, op := range Operations {
		n := ops[op]
		metrics[fmt.Sprintf("http_reqs{op:%s}", op)] = map[string]float64{"count": float64(n), "rate": float64(n) / 10}
		metrics[fmt.Sprintf("http_req_failed{op:%s}", op)] = map[string]float64{"passes": 0, "fails": float64(n)}
		for _, m := range trendMetrics {
			if n > 0 {
				metrics[fmt.Sprintf("%s{op:%s}", m, op)] = map[string]float64{"avg": 1, "min": 0, "med": 1, "max": 3, "p(90)": 2, "p(95)": 2, "p(99)": 3}
			} else {
				metrics[fmt.Sprintf("%s{op:%s}", m, op)] = map[string]float64{}
			}
		}
	}
	if mutate != nil {
		mutate(metrics)
	}
	b, err := json.Marshal(map[string]any{"metrics": metrics})
	if err != nil {
		t.Fatal(err)
	}
	file := name + ".json"
	if err := os.WriteFile(filepath.Join(dir, file), b, 0o644); err != nil {
		t.Fatal(err)
	}
	return file
}

func writeSamples(t *testing.T, dir, name string, points ...string) string {
	t.Helper()
	file := name + ".samples.json.gz"
	f, err := os.Create(filepath.Join(dir, file))
	if err != nil {
		t.Fatal(err)
	}
	zw := gzip.NewWriter(f)
	fmt.Fprintln(zw, `{"type":"Metric","data":{"type":"counter"},"metric":"http_reqs"}`)
	for _, p := range points {
		fmt.Fprintln(zw, p)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	return file
}

func point(metric, op string) string {
	return fmt.Sprintf(`{"type":"Point","metric":%q,"data":{"time":"2026-01-01T00:00:00Z","value":1,"tags":{"op":%q,"lane":"smoke"}}}`, metric, op)
}

func healthyMeta() SweepMeta {
	return SweepMeta{
		Commit: "abc1234", Lane: "smoke", K6Version: "k6 v2",
		Doctor: &DoctorReport{Reachable: true, Facts: []Fact{
			{Name: "dialect", Value: "sqlite", Source: SourceHarness}, {Name: "image_tag", Value: "x", Source: SourceHarness},
			{Name: "replicas", Value: "1", Source: SourceHarness}, {Name: "log_level", Value: "warn", Source: SourceHarness},
		}},
	}
}

// healthySweep builds a sweep directory in which every registered scenario
// ran cleanly.
func healthySweep(t *testing.T, mutate func(scenario string, m map[string]map[string]float64)) (string, SweepMeta) {
	t.Helper()
	dir := t.TempDir()
	meta := healthyMeta()
	for _, sc := range Scenarios {
		ops := map[string]int{}
		var points []string
		for _, op := range sc.Ops {
			ops[op] = 100
			points = append(points, point("http_reqs", op), point("http_req_duration", op))
		}
		run := RunMeta{Scenario: sc.Name, VUs: 5, Duration: (10 * time.Second).String()}
		run.Export = writeRun(t, dir, sc.Name, ops, func(m map[string]map[string]float64) {
			if mutate != nil {
				mutate(sc.Name, m)
			}
		})
		run.Samples = writeSamples(t, dir, sc.Name, points...)
		if sc.UsesSessions {
			run.Sessions = &SessionStats{Refreshes: 1}
		}
		meta.Runs = append(meta.Runs, run)
	}
	return dir, meta
}

var profile = SmokeExpect{VUs: 5, Duration: 10 * time.Second}

func problemsContain(problems []string, want string) bool {
	return slices.ContainsFunc(problems, func(p string) bool { return strings.Contains(p, want) })
}

func TestAssertSmokePassesAHealthyRun(t *testing.T) {
	dir, meta := healthySweep(t, nil)
	report, problems := AssertSmoke(dir, meta, profile)
	if len(problems) != 0 {
		t.Fatalf("problems on a healthy run: %v", problems)
	}
	if len(report.Scenarios) != len(Scenarios) || report.Requests == 0 {
		t.Errorf("report = %+v", report)
	}
}

// TestAssertSmokeFailsWhenItShould: each failure the issue names, plus the
// run metadata. None of them is about speed.
func TestAssertSmokeFailsWhenItShould(t *testing.T) {
	t.Run("a scenario is missing", func(t *testing.T) {
		dir, meta := healthySweep(t, nil)
		meta.Runs = meta.Runs[1:]
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "scenario login ran 0 times") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("an unregistered scenario ran", func(t *testing.T) {
		dir, meta := healthySweep(t, nil)
		meta.Runs = append(meta.Runs, RunMeta{Scenario: "ghost", VUs: 5, Duration: "10s"})
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "ghost ran but is not registered") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("a registered scenario produced no samples", func(t *testing.T) {
		dir, meta := healthySweep(t, func(sc string, m map[string]map[string]float64) {
			if sc == "getUser" {
				m["http_reqs{op:get_user}"]["count"] = 0
			}
		})
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "get_user recorded no samples") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("a trend without its percentile set", func(t *testing.T) {
		dir, meta := healthySweep(t, func(sc string, m map[string]map[string]float64) {
			if sc == "getUser" {
				delete(m["http_req_waiting{op:get_user}"], "p(95)")
			}
		})
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "http_req_waiting has no p(95)") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("a failed request", func(t *testing.T) {
		dir, meta := healthySweep(t, func(sc string, m map[string]map[string]float64) {
			if sc == "login" {
				m["http_req_failed{op:submit_password}"]["passes"] = 3
			}
		})
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "submit_password: 3 requests failed") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("a classified error", func(t *testing.T) {
		dir, meta := healthySweep(t, func(sc string, m map[string]map[string]float64) {
			if sc == "login" {
				m[MetricErrors+"{op:submit_identifier}"] = map[string]float64{"count": 2}
			}
		})
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "submit_identifier: 2 classified errors") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("an operation outside the scenario", func(t *testing.T) {
		dir, meta := healthySweep(t, func(sc string, m map[string]map[string]float64) {
			if sc == "getUser" {
				m["http_reqs{op:create_flow}"]["count"] = 4
			}
		})
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "create_flow has 4 samples but is not one of the scenario's") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("a session cache miss", func(t *testing.T) {
		dir, meta := healthySweep(t, nil)
		for i := range meta.Runs {
			if meta.Runs[i].Sessions != nil {
				meta.Runs[i].Sessions.Misses = 1
			}
		}
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "measured-path session cache misses") {
			t.Errorf("problems = %v", problems)
		}
	})
	t.Run("run metadata unpopulated", func(t *testing.T) {
		dir, meta := healthySweep(t, nil)
		meta.Commit, meta.Lane, meta.Doctor.Facts = "unknown", "", meta.Doctor.Facts[:1]
		_, problems := AssertSmoke(dir, meta, profile)
		for _, want := range []string{"commit is", "lane is empty", "image_tag is not recorded", "replicas is not recorded"} {
			if !problemsContain(problems, want) {
				t.Errorf("no problem mentioning %q in %v", want, problems)
			}
		}
	})
	t.Run("another profile than asked", func(t *testing.T) {
		dir, meta := healthySweep(t, nil)
		meta.Runs[0].VUs = 1
		_, problems := AssertSmoke(dir, meta, profile)
		if !problemsContain(problems, "ran 1 VUs") {
			t.Errorf("problems = %v", problems)
		}
	})
}

// TestAssertSmokeBoundsSeries: a path or id reaching a tag multiplies the
// series by orders of magnitude; the bound catches it without any timing.
func TestAssertSmokeBoundsSeries(t *testing.T) {
	dir, meta := healthySweep(t, nil)
	sc, _ := LookupScenario("getUser")
	var leak []string
	for i := range SeriesBound(sc) + 10 {
		leak = append(leak, fmt.Sprintf(`{"type":"Point","metric":"http_reqs","data":{"tags":{"op":"get_user","url":"/users/user_%d"}}}`, i))
	}
	for i := range meta.Runs {
		if meta.Runs[i].Scenario == "getUser" {
			meta.Runs[i].Samples = writeSamples(t, dir, "leaky", leak...)
		}
	}
	_, problems := AssertSmoke(dir, meta, profile)
	if !problemsContain(problems, "getUser: ") || !problemsContain(problems, "something unbounded is reaching a tag") {
		t.Errorf("problems = %v", problems)
	}
}

func TestCountSeriesCountsDistinctTagSets(t *testing.T) {
	dir := t.TempDir()
	file := writeSamples(t, dir, "s",
		point("http_reqs", "get_user"), point("http_reqs", "get_user"), // same series
		point("http_reqs", "create_flow"),      // another tag set
		point("http_req_duration", "get_user"), // another metric
	)
	n, err := CountSeries(filepath.Join(dir, file))
	if err != nil || n != 3 {
		t.Errorf("CountSeries = %d, %v; want 3", n, err)
	}
}

// TestSeriesBoundIsGenerousAndStructural: the bound grows with the operation
// list, not with anything a run does.
func TestSeriesBoundIsGenerousAndStructural(t *testing.T) {
	one, three := Scenario{Ops: []string{"a"}}, Scenario{Ops: []string{"a", "b", "c"}}
	if SeriesBound(three)-SeriesBound(one) != 2*MaxSeriesPerOperation {
		t.Errorf("bound %d vs %d", SeriesBound(one), SeriesBound(three))
	}
}
