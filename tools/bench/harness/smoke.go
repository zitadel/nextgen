package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/tools/bench/scripts"
)

// The smoke lane proves the harness still runs. It measures nothing: no
// assertion here is about how fast anything is — no latency threshold, no
// throughput floor, no comparison with an earlier run — because a shared
// runner under contention cannot support one. What it asserts are binary
// facts that hold on a slow runner: the harness builds, runs every registered
// scenario, emits the metrics it claims to emit, and cleans up after itself.

// SmokeConfig configures one run of the lane.
type SmokeConfig struct {
	// Server is the nextgen server binary the lane starts on SQLite.
	Server string
	// Fixtures is the fixture file; the smallest set a scenario needs.
	Fixtures string
	// K6 is the k6 binary the scenarios run in; empty means this executable.
	K6       string
	VUs      int
	Duration time.Duration
	// Dir receives the run's files. Empty uses a temporary directory that is
	// removed afterwards, so nothing is retained: a summary kept from a
	// contended shared runner is a number somebody will eventually cite.
	Dir    string
	Commit string
	Log    io.Writer
}

// SmokeReport is what a passing lane saw. It deliberately carries no timing.
type SmokeReport struct {
	Scenarios []string
	Requests  int
	Series    map[string]int
}

// MaxSeriesPerOperation and SeriesBase bound the distinct time series one run
// may emit: the tag vocabulary is operations, not paths or ids, so the count
// grows with the operation list and never with the dataset or the request
// volume. The bound is generous on purpose — it is there to catch a path or an
// id leaking into a tag, which multiplies the count by orders of magnitude.
const (
	SeriesBase            = 32
	MaxSeriesPerOperation = 24
)

// SeriesBound is the most distinct series a run of sc may emit.
func SeriesBound(sc Scenario) int { return SeriesBase + MaxSeriesPerOperation*len(sc.Ops) }

// RunSmoke runs the lane: start the SQLite server, provision, prove cleanup
// returns the target to its starting counts, run every registered scenario,
// assert the summary, clean up, stop the server. A non-nil error is a lane
// failure and says why.
func RunSmoke(ctx context.Context, cfg SmokeConfig) (SmokeReport, error) {
	logf := func(format string, args ...any) {
		if cfg.Log != nil {
			fmt.Fprintf(cfg.Log, format+"\n", args...)
		}
	}
	dir := cfg.Dir
	if dir == "" {
		tmp, err := os.MkdirTemp("", "bench-smoke-")
		if err != nil {
			return SmokeReport{}, err
		}
		defer os.RemoveAll(tmp)
		dir = tmp
	}
	fx, err := LoadFixture(cfg.Fixtures)
	if err != nil {
		return SmokeReport{}, err
	}

	logf("smoke: starting %s", cfg.Server)
	srv, err := StartServer(ctx, ServerConfig{Binary: cfg.Server, Dir: filepath.Join(dir, "server")})
	if err != nil {
		return SmokeReport{}, err
	}
	defer func() {
		if err := srv.Stop(); err != nil {
			logf("smoke: stopping the server: %v", err)
		}
	}()

	manifestPath := filepath.Join(dir, "manifest.json")
	boot := func() (Manifest, error) {
		return Bootstrap(ctx, BootstrapOptions{Base: srv.Base, Lane: "smoke", Fixture: fx, ManifestPath: manifestPath, Log: cfg.Log})
	}
	clean := func(m Manifest) (Manifest, error) {
		plan, err := PlanClean(ctx, m)
		if err != nil {
			return m, err
		}
		return ApplyClean(ctx, manifestPath, m, plan)
	}

	// The starting counts: provision, clean, and read what the target holds.
	// Cleaning is then proven by returning to exactly these numbers after the
	// scenarios have run on top.
	m, err := boot()
	if err != nil {
		return SmokeReport{}, fmt.Errorf("bootstrap: %w", err)
	}
	if m, err = clean(m); err != nil {
		return SmokeReport{}, fmt.Errorf("clean after bootstrap: %w", err)
	}
	start, err := countTarget(ctx, m)
	if err != nil {
		return SmokeReport{}, err
	}
	if start.users != 0 {
		return SmokeReport{}, fmt.Errorf("clean left %d users behind", start.users)
	}

	if m, err = boot(); err != nil {
		return SmokeReport{}, fmt.Errorf("bootstrap again: %w", err)
	}

	sweepDir := filepath.Join(dir, "sweep")
	scripts, err := writeEntryScript(dir)
	if err != nil {
		return SmokeReport{}, err
	}
	logf("smoke: running %s at %d VUs for %s each", strings.Join(ScenarioNames(), ", "), cfg.VUs, cfg.Duration)
	_, sweepErr := Sweep(ctx, SweepConfig{
		Target:         m.Target,
		Scenarios:      ScenarioNames(),
		VUs:            []int{cfg.VUs},
		Duration:       cfg.Duration,
		Script:         scripts,
		Dir:            sweepDir,
		K6:             cfg.K6,
		Raw:            true,
		Commit:         cfg.Commit,
		Log:            cfg.Log,
		ManifestPath:   manifestPath,
		Declared:       srv.Facts,
		DeclaredSource: SourceHarness,
	})

	var problems []string
	if sweepErr != nil {
		problems = append(problems, "sweep: "+sweepErr.Error())
	}
	meta, metaErr := LoadSweepMeta(sweepDir)
	var report SmokeReport
	if metaErr != nil {
		problems = append(problems, "no run metadata: "+metaErr.Error())
	} else {
		var ps []string
		report, ps = AssertSmoke(sweepDir, meta, SmokeExpect{VUs: cfg.VUs, Duration: cfg.Duration})
		problems = append(problems, ps...)
	}

	// Clean up even when the assertions failed, then check the counts.
	if m, err = clean(m); err != nil {
		problems = append(problems, "clean: "+err.Error())
	} else if end, err := countTarget(ctx, m); err != nil {
		problems = append(problems, "counting after clean: "+err.Error())
	} else if end != start {
		problems = append(problems, fmt.Sprintf("the target did not return to its starting counts: %d users and %d projects before, %d and %d after", start.users, start.projects, end.users, end.projects))
	} else if len(m.Users) != 0 || len(m.Sessions) != 0 {
		problems = append(problems, fmt.Sprintf("the manifest still lists %d users and %d sessions after clean", len(m.Users), len(m.Sessions)))
	}

	if len(problems) > 0 {
		return report, errors.New("smoke failed:\n  " + strings.Join(problems, "\n  "))
	}
	return report, nil
}

type targetCounts struct{ users, projects int }

func countTarget(ctx context.Context, m Manifest) (targetCounts, error) {
	users, err := CountUsers(ctx, m)
	if err != nil {
		return targetCounts{}, fmt.Errorf("counting users: %w", err)
	}
	projects, err := CountProjects(ctx, m)
	if err != nil {
		return targetCounts{}, fmt.Errorf("counting projects: %w", err)
	}
	return targetCounts{users: users, projects: projects}, nil
}

// SmokeExpect is the profile the lane ran with.
type SmokeExpect struct {
	VUs      int
	Duration time.Duration
}

// trendKeys is the percentile set a trend that recorded samples carries.
var trendKeys = []string{"med", "p(95)", "p(99)"}

// trendMetrics are the per-operation trends the summary reports.
var trendMetrics = []string{
	"http_req_duration", "http_req_blocked", "http_req_connecting",
	"http_req_sending", "http_req_waiting", "http_req_receiving",
}

// AssertSmoke checks a sweep directory against the registry and returns the
// report and every problem it found; none means the lane passed. Every check
// is a binary fact. None compares a number against how fast it should be.
func AssertSmoke(dir string, meta SweepMeta, want SmokeExpect) (SmokeReport, []string) {
	var problems []string
	report := SmokeReport{Series: map[string]int{}}
	bad := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	// The run metadata block is populated.
	if meta.Commit == "" || meta.Commit == "unknown" {
		bad("run metadata: commit is %q", meta.Commit)
	}
	if meta.Lane == "" {
		bad("run metadata: lane is empty")
	}
	if meta.K6Version == "" || meta.K6Version == "unknown" {
		bad("run metadata: k6 version is %q", meta.K6Version)
	}
	switch d := meta.Doctor; {
	case d == nil:
		bad("run metadata: no doctor report")
	case !d.Reachable:
		bad("run metadata: the doctor found the target unreachable")
	default:
		for _, name := range RequiredFacts {
			if f, ok := factNamed(d.Facts, name); !ok || f.Source == SourceUnknown {
				bad("run metadata: %s is not recorded", name)
			}
		}
	}

	// One entry per registered scenario: none missing, none extra.
	seen := map[string]int{}
	for _, r := range meta.Runs {
		seen[r.Scenario]++
	}
	for _, sc := range Scenarios {
		if seen[sc.Name] != 1 {
			bad("scenario %s ran %d times, want exactly once", sc.Name, seen[sc.Name])
		}
	}
	for name := range seen {
		if _, ok := LookupScenario(name); !ok {
			bad("scenario %s ran but is not registered", name)
		}
	}

	for _, run := range meta.Runs {
		sc, ok := LookupScenario(run.Scenario)
		if !ok {
			continue
		}
		report.Scenarios = append(report.Scenarios, sc.Name)
		if run.VUs != want.VUs || run.Duration != want.Duration.String() {
			bad("%s: ran %d VUs for %s, the profile is %d VUs for %s", sc.Name, run.VUs, run.Duration, want.VUs, want.Duration)
		}
		n, ps := assertRun(dir, run, sc)
		report.Requests += n
		problems = append(problems, ps...)

		if sc.UsesSessions {
			if run.Sessions == nil {
				bad("%s: no session cache numbers in the summary", sc.Name)
			} else {
				if !run.Sessions.Valid() {
					bad("%s: %d measured-path session cache misses", sc.Name, run.Sessions.Misses)
				}
				if run.Sessions.RefreshErrors != 0 {
					bad("%s: %d session refreshes failed", sc.Name, run.Sessions.RefreshErrors)
				}
			}
		}

		if run.Samples == "" {
			bad("%s: no raw samples to count series from", sc.Name)
			continue
		}
		series, err := CountSeries(filepath.Join(dir, run.Samples))
		switch {
		case err != nil:
			bad("%s: counting series: %v", sc.Name, err)
		case series == 0:
			bad("%s: no samples at all", sc.Name)
		case series > SeriesBound(sc):
			bad("%s: %d distinct time series, more than the bound %d: something unbounded is reaching a tag", sc.Name, series, SeriesBound(sc))
		default:
			report.Series[sc.Name] = series
		}
	}
	slices.Sort(report.Scenarios)
	return report, problems
}

func factNamed(facts []Fact, name string) (Fact, bool) {
	i := slices.IndexFunc(facts, func(f Fact) bool { return f.Name == name })
	if i < 0 {
		return Fact{}, false
	}
	return facts[i], true
}

// assertRun checks one run's k6 summary: exactly the scenario's operations
// have samples, each with its full percentile set, none failed, none counted
// as an error. It returns the number of requests.
func assertRun(dir string, run RunMeta, sc Scenario) (int, []string) {
	var problems []string
	bad := func(format string, args ...any) {
		problems = append(problems, fmt.Sprintf("%s: "+format, append([]any{sc.Name}, args...)...))
	}
	b, err := os.ReadFile(filepath.Join(dir, run.Export))
	if err != nil {
		bad("no summary: %v", err)
		return 0, problems
	}
	var export summaryExport
	if err := json.Unmarshal(b, &export); err != nil {
		bad("unreadable summary: %v", err)
		return 0, problems
	}

	total := 0
	for _, op := range Operations {
		reqs := export.Metrics[fmt.Sprintf("http_reqs{op:%s}", op)]
		n := int(reqs["count"])
		expected := slices.Contains(sc.Ops, op)
		switch {
		case expected && n == 0:
			bad("operation %s recorded no samples", op)
			continue
		case !expected && n > 0:
			bad("operation %s has %d samples but is not one of the scenario's", op, n)
			continue
		case !expected:
			continue
		}
		total += n

		for _, metric := range trendMetrics {
			values, ok := export.Metrics[fmt.Sprintf("%s{op:%s}", metric, op)]
			if !ok {
				bad("operation %s: %s is missing from the summary", op, metric)
				continue
			}
			for _, key := range trendKeys {
				if _, ok := values[key]; !ok {
					bad("operation %s: %s has no %s", op, metric, key)
				}
			}
		}
		if failed := export.Metrics[fmt.Sprintf("http_req_failed{op:%s}", op)]["passes"]; failed != 0 {
			bad("operation %s: %.0f requests failed", op, failed)
		}
		if errs := export.Metrics[fmt.Sprintf("%s{op:%s}", MetricErrors, op)]["count"]; errs != 0 {
			bad("operation %s: %.0f classified errors", op, errs)
		}
	}
	return total, problems
}

// writeEntryScript writes the embedded entry script into dir.
func writeEntryScript(dir string) (string, error) {
	path := filepath.Join(dir, "bench.js")
	return path, os.WriteFile(path, scripts.Bench, 0o644)
}
