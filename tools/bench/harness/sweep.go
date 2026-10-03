package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// SweepConfig is one sweep: every scenario at every VU count, one run at a
// time, against one target.
type SweepConfig struct {
	Target    Target
	Scenarios []string
	VUs       []int
	Duration  time.Duration
	// Script is the k6 entry script path.
	Script string
	// Dir receives one samples file and one k6 summary per run, runs.json and
	// summary.md.
	Dir string
	// K6 is the k6 binary to run; empty means this very executable.
	K6 string
	// Raw also keeps k6's per-sample JSON output for every run.
	Raw bool
	// Commit is recorded in the metadata; the sweep does not ask git itself.
	Commit string
	Log    io.Writer
	// ManifestPath is the target's manifest. The sweep holds its run lock for
	// as long as it runs, so `clean` refuses to remove the fixtures under it.
	ManifestPath string
	// Declared are the facts about the target the server does not report —
	// dialect, image tag, replica count, logging — and DeclaredSource says who
	// vouches for them (SourceHarness when the sweep started the server).
	Declared       map[string]string
	DeclaredSource string
	// Sessions are the session cache choices of scenarios that use it.
	Sessions SessionSettings
}

// Sweep runs the matrix and writes the summary. It returns the rows so a
// caller can print them.
func Sweep(ctx context.Context, cfg SweepConfig) ([]Row, error) {
	if err := os.MkdirAll(cfg.Dir, 0o755); err != nil {
		return nil, err
	}
	k6 := cfg.K6
	if k6 == "" {
		self, err := os.Executable()
		if err != nil {
			return nil, err
		}
		k6 = self
	}
	if cfg.ManifestPath != "" {
		lock, err := AcquireRunLock(cfg.ManifestPath, "sweep")
		if err != nil {
			return nil, err
		}
		defer func() { _ = lock.Release() }()
	}

	// The doctor check runs before the first measurement and its report is
	// part of the run metadata: it is the record of what was measured.
	var manifest *Manifest
	if cfg.ManifestPath != "" {
		m, err := LoadManifestIfPresent(cfg.ManifestPath)
		if err != nil {
			return nil, err
		}
		manifest = m
	}
	report, err := Doctor(ctx, DoctorOptions{Target: cfg.Target, Manifest: manifest, Declared: cfg.Declared, DeclaredSource: cfg.DeclaredSource})
	if err != nil {
		return nil, err
	}
	fmt.Fprint(cfg.Log, report.Format())
	if !report.Reachable {
		return nil, fmt.Errorf("the target %s is not reachable; nothing was measured", cfg.Target.Base)
	}

	host, _ := os.Hostname()
	if err := cfg.Sessions.Validate(); err != nil {
		return nil, err
	}
	meta := SweepMeta{
		Doctor:          &report,
		SessionSettings: cfg.Sessions.Env(),
		Commit:          cfg.Commit,
		RequestTimeout:  RequestTimeout.String(),
		Lane:            cfg.Target.Lane,
		Host:            host,
		CPUs:            runtime.NumCPU(),
		K6Version:       k6Version(ctx, k6),
		StartedAt:       time.Now(),
		Base:            cfg.Target.Base,
	}

	for _, scen := range cfg.Scenarios {
		for _, vus := range cfg.VUs {
			name := fmt.Sprintf("%s-%d", scen, vus)
			run := RunMeta{Scenario: scen, VUs: vus, Duration: cfg.Duration.String(), Export: name + ".json", Console: name + ".txt"}
			if cfg.Raw {
				run.Samples = name + ".samples.json.gz"
			}
			fmt.Fprintf(cfg.Log, "== %s\n", name)
			if err := runK6(ctx, k6, cfg, run); err != nil {
				return nil, fmt.Errorf("%s: %w", name, err)
			}
			stats, err := ReadSessionStats(filepath.Join(cfg.Dir, run.Export))
			if err != nil {
				return nil, fmt.Errorf("%s: %w", name, err)
			}
			if stats.Used() {
				run.Sessions = &stats
			}
			meta.Runs = append(meta.Runs, run)
			// Let the server drain before the next run measures it.
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(2 * time.Second):
			}
		}
	}

	if err := writeJSON(filepath.Join(cfg.Dir, "runs.json"), meta); err != nil {
		return nil, err
	}
	rows, err := WriteSummary(cfg.Dir, meta)
	if err != nil {
		return nil, err
	}
	// A window in which a VU paid for a login is not reported as a result: the
	// summary says so, and the sweep fails so it cannot be missed.
	if invalid := meta.Invalid(); len(invalid) > 0 {
		return rows, fmt.Errorf("invalid windows, do not cite these numbers:\n  %s", strings.Join(invalid, "\n  "))
	}
	return rows, nil
}

// WriteSummary summarises a sweep directory into summary.md and
// aggregate.json and returns the rows.
func WriteSummary(dir string, meta SweepMeta) ([]Row, error) {
	rows, err := Summarize(dir, meta)
	if err != nil {
		return nil, err
	}
	if err := writeJSON(filepath.Join(dir, "aggregate.json"), rows); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "summary.md"), []byte(Markdown(meta, rows)), 0o644); err != nil {
		return nil, err
	}
	return rows, nil
}

// LoadSweepMeta reads runs.json from a sweep directory.
func LoadSweepMeta(dir string) (SweepMeta, error) {
	var meta SweepMeta
	b, err := os.ReadFile(filepath.Join(dir, "runs.json"))
	if err != nil {
		return meta, err
	}
	return meta, json.Unmarshal(b, &meta)
}

func runK6(ctx context.Context, k6 string, cfg SweepConfig, run RunMeta) error {
	console, err := os.Create(filepath.Join(cfg.Dir, run.Console))
	if err != nil {
		return err
	}
	defer console.Close()

	// k6 aggregates; the sweep only asks for the stats the table shows and
	// keeps the document k6 would print anyway.
	args := []string{
		"run", "--quiet", "--no-color", "--no-usage-report", "--summary-mode", "compact",
		"--summary-trend-stats", "avg,min,med,max,p(90),p(95),p(99)",
		"--summary-export", filepath.Join(cfg.Dir, run.Export),
		"-e", "SCEN=" + run.Scenario,
		"-e", "VUS=" + strconv.Itoa(run.VUs),
		"-e", "DUR=" + run.Duration,
	}
	for k, v := range cfg.Target.Env() {
		args = append(args, "-e", k+"="+v)
	}
	for k, v := range cfg.Sessions.Env() {
		args = append(args, "-e", k+"="+v)
	}
	if run.Samples != "" {
		args = append(args, "--out", "json="+filepath.Join(cfg.Dir, run.Samples))
	}
	args = append(args, cfg.Script)

	cmd := exec.CommandContext(ctx, k6, args...)
	cmd.Stdout = console
	cmd.Stderr = console
	if err := cmd.Run(); err != nil {
		tail, _ := os.ReadFile(filepath.Join(cfg.Dir, run.Console))
		return fmt.Errorf("k6 run failed: %w\n%s", err, lastLines(string(tail), 30))
	}
	// What the operator needs to see at once is whether anything failed.
	b, _ := os.ReadFile(filepath.Join(cfg.Dir, run.Console))
	for line := range strings.SplitSeq(string(b), "\n") {
		if strings.Contains(line, "http_req_failed") || strings.Contains(line, "http_reqs") || strings.Contains(line, "level=error") {
			fmt.Fprintln(cfg.Log, strings.TrimSpace(line))
		}
	}
	return nil
}

func k6Version(ctx context.Context, k6 string) string {
	out, err := exec.CommandContext(ctx, k6, "version").Output()
	if err != nil {
		return "unknown"
	}
	first, _, _ := strings.Cut(string(out), "\n")
	return strings.TrimSpace(first)
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}
