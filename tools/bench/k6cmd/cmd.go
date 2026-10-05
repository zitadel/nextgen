// Package k6cmd registers the `k6 x nextgen` subcommand tree: bootstrap a
// target from a fixture file, run a sweep, summarise a sweep directory.
//
// Every command runs against a server somebody else started: Moon on the
// local lane, a container or a cloud deployment on the others. The harness
// only checks that it is there and healthy.
package k6cmd

import (
	"context"
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
	root.AddCommand(newBootstrapCommand(gs), newSweepCommand(gs), newSummarizeCommand(gs))
	return root
}

func newBootstrapCommand(gs *state.GlobalState) *cobra.Command {
	var base, fixtures, stateFile, lane string
	cmd := &cobra.Command{
		Use:   "bootstrap",
		Short: "Provision the project and user a fixture file declares on a running server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			target, err := bootstrap(cmd.Context(), gs, base, lane, fixtures, stateFile)
			if err != nil {
				return err
			}
			fmt.Fprintf(gs.Stdout, "project %s user %s → %s\n", target.ProjectID, target.UserID, stateFile)
			return nil
		},
	}
	cmd.Flags().StringVar(&base, "base", "", "Base URL of the running server to provision (required)")
	cmd.Flags().StringVar(&fixtures, "fixtures", "fixtures/local.json", "Fixture file declaring the project and user")
	cmd.Flags().StringVar(&stateFile, "state", "out/target.json", "Where to write the provisioned target")
	cmd.Flags().StringVar(&lane, "lane", "local", "Lane tag recorded on every sample")
	_ = cmd.MarkFlagRequired("base")
	return cmd
}

func newSweepCommand(gs *state.GlobalState) *cobra.Command {
	var (
		base, fixtures, stateFile, lane, out, script, scenarios, vus string
		duration                                                     time.Duration
		raw                                                          bool
	)
	cmd := &cobra.Command{
		Use:   "sweep",
		Short: "Run every scenario at every VU count, one run at a time, and summarise",
		Long: `Run every scenario at every VU count, one run at a time, and summarise.

The target is --state (a target bootstrap already provisioned) or --base (a
running server, provisioned from --fixtures first). Either way the server
must already be up and answering /healthz; the sweep never starts one.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			dir := out
			if dir == "" {
				dir = filepath.Join("out", "sweep-"+time.Now().UTC().Format("20060102T150405Z"))
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}

			target, err := resolveTarget(ctx, gs, base, fixtures, stateFile, lane, dir)
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
				Target:    target,
				Scenarios: strings.Split(scenarios, ","),
				VUs:       vuList,
				Duration:  duration,
				Script:    scriptPath,
				Dir:       dir,
				Commit:    gitCommit(ctx),
				Raw:       raw,
				Log:       gs.Stdout,
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
	cmd.Flags().StringVar(&stateFile, "state", "", "An already provisioned target (written by bootstrap)")
	cmd.Flags().StringVar(&base, "base", "", "A running server to provision and measure")
	cmd.Flags().StringVar(&fixtures, "fixtures", "fixtures/local.json", "Fixture file applied to --base")
	cmd.Flags().StringVar(&lane, "lane", "local", "Lane tag recorded on every sample")
	cmd.Flags().StringVar(&out, "out", "", "Output directory (default out/sweep-<timestamp>)")
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

// resolveTarget picks the target the flags describe and proves the server
// behind it is up before anything is written or measured.
func resolveTarget(ctx context.Context, gs *state.GlobalState, base, fixtures, stateFile, lane, dir string) (harness.Target, error) {
	switch {
	case stateFile != "":
		t, err := harness.LoadTarget(stateFile)
		if err != nil {
			return harness.Target{}, err
		}
		return t, harness.CheckReady(ctx, t.Base)
	case base != "":
		return bootstrap(ctx, gs, base, lane, fixtures, filepath.Join(dir, "target.json"))
	default:
		return harness.Target{}, fmt.Errorf("one of --state or --base is required")
	}
}

func bootstrap(ctx context.Context, gs *state.GlobalState, base, lane, fixtures, stateFile string) (harness.Target, error) {
	if err := harness.CheckReady(ctx, base); err != nil {
		return harness.Target{}, err
	}
	fx, err := harness.LoadFixture(fixtures)
	if err != nil {
		return harness.Target{}, err
	}
	t, err := harness.Bootstrap(ctx, base, lane, fx)
	if err != nil {
		return harness.Target{}, err
	}
	fmt.Fprintf(gs.Stdout, "provisioned project %s user %s on %s\n", t.ProjectID, t.UserID, base)
	return t, harness.SaveTarget(stateFile, t)
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
