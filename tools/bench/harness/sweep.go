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
	// Commit is recorded in the metadata; the sweep does not ask git itself.
	Commit string
	Log    io.Writer
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
	host, _ := os.Hostname()
	meta := SweepMeta{
		Commit:    cfg.Commit,
		Lane:      cfg.Target.Lane,
		Host:      host,
		CPUs:      runtime.NumCPU(),
		K6Version: k6Version(ctx, k6),
		StartedAt: time.Now(),
		Base:      cfg.Target.Base,
	}

	for _, scen := range cfg.Scenarios {
		for _, vus := range cfg.VUs {
			name := fmt.Sprintf("%s-%d", scen, vus)
			run := RunMeta{Scenario: scen, VUs: vus, Duration: cfg.Duration.String(), Samples: name + ".json.gz", Summary: name + ".txt"}
			fmt.Fprintf(cfg.Log, "== %s\n", name)
			if err := runK6(ctx, k6, cfg, run); err != nil {
				return nil, fmt.Errorf("%s: %w", name, err)
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
	return WriteSummary(cfg.Dir, meta)
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
	summary, err := os.Create(filepath.Join(cfg.Dir, run.Summary))
	if err != nil {
		return err
	}
	defer summary.Close()

	args := []string{
		"run", "--quiet", "--no-color", "--no-usage-report", "--summary-mode", "compact",
		"--out", "json=" + filepath.Join(cfg.Dir, run.Samples),
		"-e", "SCEN=" + run.Scenario,
		"-e", "VUS=" + strconv.Itoa(run.VUs),
		"-e", "DUR=" + run.Duration,
	}
	for k, v := range cfg.Target.Env() {
		args = append(args, "-e", k+"="+v)
	}
	args = append(args, cfg.Script)

	cmd := exec.CommandContext(ctx, k6, args...)
	cmd.Stdout = summary
	cmd.Stderr = summary
	if err := cmd.Run(); err != nil {
		tail, _ := os.ReadFile(filepath.Join(cfg.Dir, run.Summary))
		return fmt.Errorf("k6 run failed: %w\n%s", err, lastLines(string(tail), 30))
	}
	// The summary is k6's; what the operator needs to see at once is whether
	// anything failed.
	b, _ := os.ReadFile(filepath.Join(cfg.Dir, run.Summary))
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
