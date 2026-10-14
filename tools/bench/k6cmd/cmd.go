// Package k6cmd registers the `k6 x nextgen` subcommand tree: bootstrap a
// target from a fixture file, check it, run a sweep, clean up, summarise a
// sweep directory.
//
// Every command runs against a server somebody else started: Moon on the
// local lane, a container or a cloud deployment on the others. The harness
// only checks that it is there and healthy.
package k6cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"go.k6.io/k6/v2/cmd/state"
	"go.k6.io/k6/v2/subcommand"

	"github.com/zitadel/nextgen/tools/bench/harness"
	"github.com/zitadel/nextgen/tools/bench/scripts"
)

// defaultManifest is where bootstrap, clean, doctor and sweep look unless told
// otherwise.
const defaultManifest = "dist/manifest.json"

func init() {
	subcommand.RegisterExtension("nextgen", newCommand)
}

func newCommand(gs *state.GlobalState) *cobra.Command {
	root := &cobra.Command{
		Use:   "nextgen",
		Short: "Benchmark the nextgen API",
		Long: `Benchmark the nextgen API.

The scenarios live in the k6/x/nextgen module compiled into this binary; these
commands provision a running server, run the scenarios against it, and
summarise the result. Starting the server is the lane's job, not theirs.`,
		SilenceUsage: true,
	}
	root.AddCommand(newBootstrapCommand(gs), newCleanCommand(gs), newDoctorCommand(gs), newSweepCommand(gs), newSummarizeCommand(gs))
	return root
}

func newBootstrapCommand(gs *state.GlobalState) *cobra.Command {
	var base, fixtures, manifest, lane string
	cmd := &cobra.Command{
		Use:   "bootstrap",
		Short: "Provision the project and users a fixture file declares on a running server",
		Long: `Provision the project and users a fixture file declares on a running server.

Everything created is recorded in the manifest, which clean, doctor and the
scenarios read. Running it again against the same manifest is safe: what the
target still has is kept and only what is missing is created.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, err := bootstrap(cmd.Context(), gs, base, lane, fixtures, manifest)
			if err != nil {
				return err
			}
			fmt.Fprintf(gs.Stdout, "project %s, %d users → %s\n", m.Project.ID, len(m.Users), manifest)
			return nil
		},
	}
	cmd.Flags().StringVar(&base, "base", "", "Base URL of the running server to provision (required)")
	cmd.Flags().StringVar(&fixtures, "fixtures", "fixtures/local.json", "Fixture file declaring the project and users")
	cmd.Flags().StringVar(&manifest, "manifest", defaultManifest, "Where the fixture manifest is read and written")
	cmd.Flags().StringVar(&lane, "lane", "local", "Lane tag recorded on every sample")
	_ = cmd.MarkFlagRequired("base")
	return cmd
}

func newCleanCommand(gs *state.GlobalState) *cobra.Command {
	var manifest string
	var confirm bool
	cmd := &cobra.Command{
		Use:   "clean",
		Short: "Remove the resources bootstrap created, and only those",
		Long: `Remove the resources bootstrap created, and only those.

A resource is removed only when the manifest names it AND its name matches the
harness naming convention in full; anything else on the target is left alone.
Without --confirm nothing is changed: the command prints what it would do.
It refuses while a sweep or bootstrap is running against the same manifest.

The API has no delete-project operation, so the project stays and the next
bootstrap reuses it.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			m, err := harness.LoadManifest(manifest)
			if err != nil {
				return fmt.Errorf("reading the manifest (has bootstrap run?): %w", err)
			}
			if err := harness.CheckNoRun(manifest); err != nil {
				return err
			}
			if confirm {
				lock, err := harness.AcquireRunLock(manifest, "clean")
				if err != nil {
					return err
				}
				defer func() { _ = lock.Release() }()
			}

			plan, err := harness.PlanClean(ctx, m)
			if err != nil {
				return err
			}
			for _, it := range plan.Items {
				line := fmt.Sprintf("%-8s %-8s %s", it.Action, it.Kind, it.ID)
				if it.Name != "" {
					line += " (" + it.Name + ")"
				}
				if it.Reason != "" {
					line += ": " + it.Reason
				}
				fmt.Fprintln(gs.Stdout, line)
			}
			if !confirm {
				fmt.Fprintf(gs.Stdout, "\ndry run: would delete %d users, revoke %d sessions; nothing was changed. Pass --confirm to act.\n",
					plan.Count(harness.ActionDelete), plan.Count(harness.ActionRevoke))
				return nil
			}

			m, err = harness.ApplyClean(ctx, manifest, m, plan)
			if err != nil {
				return err
			}
			remaining, err := harness.CountUsers(ctx, m)
			if err != nil {
				return fmt.Errorf("counting the users left: %w", err)
			}
			fmt.Fprintf(gs.Stdout, "\ncleaned: the manifest now lists %d users; the project holds %d users\n", len(m.Users), remaining)
			return nil
		},
	}
	cmd.Flags().StringVar(&manifest, "manifest", defaultManifest, "The fixture manifest bootstrap wrote")
	cmd.Flags().BoolVar(&confirm, "confirm", false, "Act; without it clean only prints what it would do")
	return cmd
}

func newDoctorCommand(gs *state.GlobalState) *cobra.Command {
	var manifest, base, lane, out string
	var declare []string
	cmd := &cobra.Command{
		Use:   "doctor",
		Short: "Check the target and print what a benchmark would be measuring",
		Long: `Check the target and print what a benchmark would be measuring.

Reachability and the manifest's fixtures are observed. The server API does not
report its dialect, image tag, replica count or logging, so those are taken
from --declare and the report says which facts were declared and which were
not known:

  doctor --declare dialect=postgres --declare image_tag=v1.2.3 \
         --declare replicas=3 --declare log_level=warn

Run it before a sweep; a sweep runs it itself and keeps the report in its
run metadata. Exits non-zero when the target is not reachable.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			declared, err := parseDeclared(declare)
			if err != nil {
				return err
			}
			opts := harness.DoctorOptions{Declared: declared}
			if m, err := harness.LoadManifestIfPresent(manifest); err != nil {
				return err
			} else if m != nil {
				opts.Manifest = m
				opts.Target = m.Target
			}
			if base != "" {
				opts.Target.Base = base
			}
			if lane != "" {
				opts.Target.Lane = lane
			}
			if opts.Target.Base == "" {
				return fmt.Errorf("no target: pass --base, or --manifest of a bootstrapped target")
			}
			report, err := harness.Doctor(cmd.Context(), opts)
			if err != nil {
				return err
			}
			fmt.Fprint(gs.Stdout, report.Format())
			if out != "" {
				b, err := json.MarshalIndent(report, "", "  ")
				if err != nil {
					return err
				}
				if err := os.WriteFile(out, append(b, '\n'), 0o644); err != nil {
					return err
				}
			}
			if !report.Reachable {
				return fmt.Errorf("the target %s is not reachable", report.Base)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&manifest, "manifest", defaultManifest, "The fixture manifest, if one exists")
	cmd.Flags().StringVar(&base, "base", "", "Base URL to check (default: the manifest's)")
	cmd.Flags().StringVar(&lane, "lane", "", "Lane tag to record (default: the manifest's)")
	cmd.Flags().StringArrayVar(&declare, "declare", nil, "A fact about the target the server does not report, as name=value (repeatable)")
	cmd.Flags().StringVar(&out, "out", "", "Also write the report as JSON to this file")
	return cmd
}

func newSweepCommand(gs *state.GlobalState) *cobra.Command {
	var (
		base, fixtures, manifest, lane, out, script, scenarios, vus string
		declare                                                     []string
		duration                                                    time.Duration
		raw                                                         bool
	)
	cmd := &cobra.Command{
		Use:   "sweep",
		Short: "Run every scenario at every VU count, one run at a time, and summarise",
		Long: `Run every scenario at every VU count, one run at a time, and summarise.

The target is --base (a running server, provisioned into --manifest from
--fixtures first) or an already provisioned --manifest. Either way the server
must already be up; the sweep never starts one.

The sweep checks the target first (see doctor) and keeps the report in its run
metadata, and holds the run lock on the manifest so clean refuses meanwhile.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			dir := out
			if dir == "" {
				dir = filepath.Join("dist", "sweep-"+time.Now().UTC().Format("20060102T150405Z"))
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}

			declared, err := parseDeclared(declare)
			if err != nil {
				return err
			}
			resolved, err := resolveTarget(ctx, gs, targetFlags{
				base: base, fixtures: fixtures,
				manifest: manifest, manifestSet: cmd.Flags().Changed("manifest"), lane: lane,
			})
			if err != nil {
				return err
			}

			scriptPath := script
			if scriptPath == "" {
				scriptPath = filepath.Join(dir, "bench.js")
				if err := os.WriteFile(scriptPath, scripts.Bench, 0o644); err != nil {
					return err
				}
			}
			vuList, err := parseInts(vus)
			if err != nil {
				return fmt.Errorf("--vus: %w", err)
			}
			rows, err := harness.Sweep(ctx, harness.SweepConfig{
				Target:    resolved.target,
				Scenarios: strings.Split(scenarios, ","),
				VUs:       vuList,
				Duration:  duration,
				Script:    scriptPath,
				Dir:       dir,
				Commit:    gitCommit(ctx),
				Raw:       raw,
				Log:       gs.Stdout,

				ManifestPath:   resolved.manifest,
				Declared:       declared,
				DeclaredSource: harness.SourceDeclared,
			})
			if err != nil {
				return err
			}
			meta, err := harness.LoadSweepMeta(dir)
			if err != nil {
				return err
			}
			fmt.Fprintln(gs.Stdout)
			fmt.Fprint(gs.Stdout, harness.Markdown(meta, rows))
			fmt.Fprintf(gs.Stdout, "\nwritten to %s\n", dir)
			return nil
		},
	}
	cmd.Flags().StringVar(&manifest, "manifest", defaultManifest, "The fixture manifest: read as the provisioned target, or written by --base")
	cmd.Flags().StringArrayVar(&declare, "declare", nil, "A fact about the target the server does not report, as name=value (repeatable)")
	cmd.Flags().StringVar(&base, "base", "", "A running server to provision and measure")
	cmd.Flags().StringVar(&fixtures, "fixtures", "fixtures/local.json", "Fixture file applied to --base")
	cmd.Flags().StringVar(&lane, "lane", "local", "Lane tag recorded on every sample")
	cmd.Flags().StringVar(&out, "out", "", "Output directory (default dist/sweep-<timestamp>)")
	cmd.Flags().StringVar(&script, "script", "", "k6 entry script (default: the embedded bench.js)")
	cmd.Flags().StringVar(&scenarios, "scenarios", "login,getUser", "Scenarios to run, comma separated")
	cmd.Flags().StringVar(&vus, "vus", "1,5,20", "VU counts to run, comma separated")
	cmd.Flags().DurationVar(&duration, "duration", 20*time.Second, "Duration of each run")
	cmd.Flags().BoolVar(&raw, "raw", false, "Also keep k6's per-sample JSON output for every run")
	return cmd
}

func newSummarizeCommand(gs *state.GlobalState) *cobra.Command {
	return &cobra.Command{
		Use:   "summarize <sweep-dir>",
		Short: "Rewrite summary.md and aggregate.json for a sweep directory from k6's per-run summaries",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			meta, err := harness.LoadSweepMeta(args[0])
			if err != nil {
				return err
			}
			rows, err := harness.WriteSummary(args[0], meta)
			if err != nil {
				return err
			}
			fmt.Fprint(gs.Stdout, harness.Markdown(meta, rows))
			return nil
		},
	}
}

// targetFlags is what the sweep's target flags say.
type targetFlags struct {
	base, fixtures, manifest, lane string
	manifestSet                    bool
}

// resolvedTarget is the target a sweep runs against.
type resolvedTarget struct {
	target harness.Target
	// manifest is the manifest path the run lock and doctor use.
	manifest string
}

// resolveTarget picks the target the flags describe. The server behind it
// is somebody else's to run; the sweep's doctor check proves it answers.
func resolveTarget(ctx context.Context, gs *state.GlobalState, f targetFlags) (resolvedTarget, error) {
	switch {
	case f.base != "":
		m, err := bootstrap(ctx, gs, f.base, f.lane, f.fixtures, f.manifest)
		return resolvedTarget{target: m.Target, manifest: f.manifest}, err
	case f.manifestSet:
		m, err := harness.LoadManifest(f.manifest)
		return resolvedTarget{target: m.Target, manifest: f.manifest}, err
	default:
		return resolvedTarget{}, fmt.Errorf("one of --base or --manifest is required")
	}
}

// bootstrap proves the server is up, then applies the fixture into the
// manifest.
func bootstrap(ctx context.Context, gs *state.GlobalState, base, lane, fixtures, manifest string) (harness.Manifest, error) {
	if err := harness.CheckReady(ctx, base); err != nil {
		return harness.Manifest{}, err
	}
	fx, err := harness.LoadFixture(fixtures)
	if err != nil {
		return harness.Manifest{}, err
	}
	return harness.Bootstrap(ctx, harness.BootstrapOptions{Base: base, Lane: lane, Fixture: fx, ManifestPath: manifest, Log: gs.Stdout})
}

// parseDeclared reads repeated name=value flags.
func parseDeclared(flags []string) (map[string]string, error) {
	declared := make(map[string]string, len(flags))
	for _, kv := range flags {
		name, value, ok := strings.Cut(kv, "=")
		if !ok || name == "" || value == "" {
			return nil, fmt.Errorf("--declare %q: want name=value", kv)
		}
		declared[name] = value
	}
	return declared, nil
}

func parseInts(s string) ([]int, error) {
	var out []int
	for part := range strings.SplitSeq(s, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

func gitCommit(ctx context.Context) string {
	out, err := exec.CommandContext(ctx, "git", "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}
