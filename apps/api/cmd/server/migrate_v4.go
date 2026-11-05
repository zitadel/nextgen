package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/cobra"

	"github.com/zitadel/nextgen/internal/migratev4"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres"
)

// migrateV4Flags are the flags every migrate-v4 subcommand shares.
type migrateV4Flags struct {
	source          string
	instance        string
	masterKeyFile   string
	project         string
	identifier      string
	defaultOrgUsers string
	v4Stopped       bool
	targetStopped   bool
	dryRun          bool
	forceCleanup    bool
	includePII      bool
	jsonOut         string
	follow          time.Duration
	format          string
	v4Callback      string
	v4CallbackFor   map[string]string
}

// newMigrateV4Command is `nextgen migrate-v4`: migrate a Zitadel v4 instance
// into a nextgen project (docs/design/migrate-v4/README.md). Proof of concept.
func newMigrateV4Command(configPath *string) *cobra.Command {
	flags := &migrateV4Flags{}
	cmd := &cobra.Command{
		Use:   "migrate-v4",
		Short: "Migrate a Zitadel v4 instance into a nextgen project (proof of concept)",
		Long: `Reads a Zitadel v4 database directly and migrates organizations, human users
with their password hashes, generic OIDC and Google IdPs and the users' IdP links
into a new nextgen project during an offline maintenance window.
Stop both servers and all other target writers before run and verify.
Unsupported lifecycle changes and policy mismatches block the whole import.

The v4 database defaults to nextgen's own PostgreSQL connection: run nextgen in
the database v4 already uses, in its own schema.`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	pf := cmd.PersistentFlags()
	pf.StringVar(&flags.source, "source", os.Getenv("NEXTGEN_MIGRATE_V4_SOURCE"), "PostgreSQL DSN of the v4 database (default: nextgen's database; env NEXTGEN_MIGRATE_V4_SOURCE)")
	pf.StringVar(&flags.instance, "instance", "", "v4 instance id (required when the database holds more than one)")
	pf.StringVar(&flags.masterKeyFile, "v4-masterkey-file", "", "file holding the 32-byte v4 master key (or env ZITADEL_MASTERKEY); needed to move IdP client secrets")
	pf.StringVar(&flags.project, "project", "", "existing-project imports are not supported by this POC; omit to create a project")
	pf.StringVar(&flags.identifier, "identifier", migratev4.IdentifierEmail, "the property users sign in with: email or login_name")
	pf.StringVar(&flags.defaultOrgUsers, "default-org-users", migratev4.DefaultOrgUsersTeam, "default org users remain team-owned (team only)")
	pf.BoolVar(&flags.v4Stopped, "v4-stopped", false, "confirm v4 and its event writers are stopped")
	pf.BoolVar(&flags.targetStopped, "target-stopped", false, "confirm nextgen serving processes and all other target writers are stopped")
	pf.BoolVar(&flags.includePII, "include-pii", false, "let the report name users and values in its issues")
	pf.StringVar(&flags.v4Callback, "v4-callback", "", "keep this v4 callback URL (https://HOST/ui/login/login/externalidp/callback or https://HOST/idps/callback) as every migrated IdP's redirect URI, so the providers need no new registration; HOST must reach nextgen")
	pf.StringToStringVar(&flags.v4CallbackFor, "v4-callback-for", nil, "per-IdP override of --v4-callback: V4_IDP_ID=URL, repeatable")
	pf.StringVar(&flags.jsonOut, "json", "", "write one JSON report to stdout; use --json=FILE for a private report file")

	pf.Lookup("json").NoOptDefVal = "-"

	run := &cobra.Command{
		Use:   "run",
		Short: "Ingest v4 and converge nextgen to it",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if flags.follow > 0 {
				return errors.New("--follow is not supported safely yet; use an offline run")
			}
			if !flags.dryRun && (!flags.v4Stopped || !flags.targetStopped) {
				return errors.New("run requires --v4-stopped and --target-stopped")
			}
			return withMigrator(cmd.Context(), *configPath, flags, func(ctx context.Context, m *migratev4.Migrator, opts migratev4.Options) error {
				if flags.follow <= 0 {
					var report *migratev4.Report
					var err error
					if flags.dryRun {
						report, err = m.Assess(ctx, opts)
					} else {
						report, err = m.Run(ctx, opts)
					}
					if report != nil {
						if outErr := writeReport(cmd.OutOrStdout(), flags, report); outErr != nil {
							return errors.Join(err, outErr)
						}
					}
					return err
				}
				return m.Follow(ctx, opts, flags.follow, nil)
			})
		},
	}
	run.Flags().BoolVar(&flags.dryRun, "dry-run", false, "assess without creating or changing target resources")
	run.Flags().DurationVar(&flags.follow, "follow", 0, "keep running, pausing this long between runs (e.g. 30s)")

	assess := &cobra.Command{
		Use:   "assess",
		Short: "Report what the v4 instance holds and what would migrate; writes nothing to nextgen",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return withMigrator(cmd.Context(), *configPath, flags, func(ctx context.Context, m *migratev4.Migrator, opts migratev4.Options) error {
				report, err := m.Assess(ctx, opts)
				if report != nil {
					err = errors.Join(err, writeReport(cmd.OutOrStdout(), flags, report))
				}
				return err
			})
		},
	}

	verify := &cobra.Command{
		Use:   "verify",
		Short: "Check that nextgen holds what should have migrated",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return withMigrator(cmd.Context(), *configPath, flags, func(ctx context.Context, m *migratev4.Migrator, opts migratev4.Options) error {
				report, err := m.Verify(ctx, opts)
				if report != nil {
					err = errors.Join(err, writeReport(cmd.OutOrStdout(), flags, report))
				}
				return err
			})
		},
	}

	status := &cobra.Command{
		Use:   "status",
		Short: "Show how far the migration has read v4 and what it wrote",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if flags.jsonOut != "" {
				return errors.New("status currently supports text output only")
			}
			return withMigrator(cmd.Context(), *configPath, flags, func(ctx context.Context, m *migratev4.Migrator, opts migratev4.Options) error {
				return m.Status(ctx, opts.InstanceID, cmd.OutOrStdout())
			})
		},
	}

	exportIDs := &cobra.Command{
		Use:   "export-ids",
		Short: "Write which nextgen id each migrated v4 user and org got",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if flags.jsonOut != "" {
				return errors.New("export-ids uses --format json, not --json")
			}
			return withMigrator(cmd.Context(), *configPath, flags, func(ctx context.Context, m *migratev4.Migrator, opts migratev4.Options) error {
				return m.ExportIDs(ctx, opts.InstanceID, flags.format, cmd.OutOrStdout())
			})
		},
	}
	exportIDs.Flags().StringVar(&flags.format, "format", "csv", "csv or json")

	cleanup := &cobra.Command{
		Use:   "cleanup",
		Short: "Drop the migrator's state for the instance, password hashes included; nextgen data stays",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if flags.jsonOut != "" {
				return errors.New("cleanup currently supports text output only")
			}
			return withMigrator(cmd.Context(), *configPath, flags, func(ctx context.Context, m *migratev4.Migrator, opts migratev4.Options) error {
				return m.Cleanup(ctx, opts.InstanceID, flags.forceCleanup)
			})
		},
	}

	cleanup.Flags().BoolVar(&flags.forceCleanup, "force", false, "remove this instance's ledger without a successful offline verify (pending applies must still be recovered)")
	for _, sub := range []*cobra.Command{assess, run, verify, status, exportIDs, cleanup} {
		sub.Args = cobra.NoArgs
	}
	cmd.AddCommand(assess, run, verify, status, exportIDs, cleanup)
	return cmd
}

func writeReport(stdout io.Writer, flags *migrateV4Flags, report *migratev4.Report) error {
	if flags.jsonOut == "" {
		return report.WriteText(stdout)
	}
	out := stdout
	if flags.jsonOut != "-" {
		if err := report.WriteText(stdout); err != nil {
			return err
		}
		f, err := os.OpenFile(flags.jsonOut, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		if err := f.Chmod(0o600); err != nil {
			return err
		}
		out = f
	}
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

// withMigrator builds the migrator from nextgen's configuration and the
// flags, resolves the instance, and runs fn.
func withMigrator(ctx context.Context, configPath string, flags *migrateV4Flags, fn func(context.Context, *migratev4.Migrator, migratev4.Options) error) error {
	cfg, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	dialect, err := buildDatabaseDialect(cfg)
	if err != nil {
		return err
	}
	var target *pgxpool.Config
	switch d := dialect.(type) {
	case *postgres.Config:
		target = d.Config
	case postgres.Config:
		target = d.Config
	default:
		return fmt.Errorf("migrate-v4 needs nextgen on PostgreSQL, not %s", dialect.Name())
	}

	sourceConfig := target.Copy()
	if flags.source != "" {
		if sourceConfig, err = pgxpool.ParseConfig(flags.source); err != nil {
			return fmt.Errorf("--source: %w", err)
		}
	}
	src, err := v4.Open(ctx, sourceConfig)
	if err != nil {
		return err
	}
	defer src.Close()
	store, err := stage.Open(ctx, target.Copy())
	if err != nil {
		return err
	}
	defer store.Close()

	deps, closeDeps, err := migrateV4Deps(ctx, cfg)
	if err != nil {
		return err
	}
	defer closeDeps()
	m := migratev4.New(src, store, deps)

	opts := migratev4.Options{
		InstanceID:      flags.instance,
		ProjectID:       flags.project,
		Identifier:      flags.identifier,
		DefaultOrgUsers: flags.defaultOrgUsers,
		SourceStopped:   flags.v4Stopped,
		TargetStopped:   flags.targetStopped,
		IncludePII:      flags.includePII,
		V4Callback:      flags.v4Callback,
		V4CallbackFor:   flags.v4CallbackFor,
	}
	if opts.Identifier != migratev4.IdentifierEmail && opts.Identifier != migratev4.IdentifierLoginName {
		return fmt.Errorf("--identifier must be %s or %s", migratev4.IdentifierEmail, migratev4.IdentifierLoginName)
	}
	if opts.DefaultOrgUsers != migratev4.DefaultOrgUsersTeam {
		return errors.New("--default-org-users must be team")
	}
	if opts.MasterKey, err = v4MasterKey(flags.masterKeyFile); err != nil {
		return err
	}
	if opts.InstanceID == "" {
		instances, err := m.Instances(ctx)
		if err != nil {
			return err
		}
		var live []string
		for _, instance := range instances {
			if !instance.Removed {
				live = append(live, instance.ID+" ("+instance.Name+")")
			}
		}
		if len(live) != 1 {
			return fmt.Errorf("the v4 database holds %d instances, pass --instance: %s", len(live), strings.Join(live, ", "))
		}
		opts.InstanceID = strings.SplitN(live[0], " ", 2)[0]
	}
	return fn(ctx, m, opts)
}

// v4MasterKey reads the v4 master key from the file, or from ZITADEL_MASTERKEY
// as v4 itself does. No key is not an error: the IdP secrets stay behind.
func v4MasterKey(file string) ([]byte, error) {
	if file != "" {
		key, err := os.ReadFile(file)
		if err != nil {
			return nil, fmt.Errorf("--v4-masterkey-file: %w", err)
		}
		return []byte(strings.TrimRight(string(key), "\r\n")), nil
	}
	if key := os.Getenv("ZITADEL_MASTERKEY"); key != "" {
		return []byte(key), nil
	}
	return nil, nil
}

// migrateV4Deps connects without applying target database migrations and builds
// the services the migrator writes through from the server's configuration.
func migrateV4Deps(ctx context.Context, cfg Config) (migratev4.Deps, func(), error) {
	pool, err := startDatabase(ctx, cfg, false)
	if err != nil {
		return migratev4.Deps{}, nil, err
	}
	closePool := func() { _ = pool.Close(context.WithoutCancel(ctx)) }
	masterKeys, err := buildMasterKey(cfg.Server.MasterKeys)
	if err != nil {
		closePool()
		return migratev4.Deps{}, nil, fmt.Errorf("failed to create Crypter: %w", err)
	}
	hashers, err := cfg.PasswordHasher.NewHasherFactory()
	if err != nil {
		closePool()
		return migratev4.Deps{}, nil, fmt.Errorf("failed to build password hasher: %w", err)
	}
	deps, err := migratev4.NewDeps(pool.(service.Pool), migratev4.DepsConfig{
		MasterKeys:          *masterKeys,
		Hashers:             hashers,
		BuiltinPublicBase:   cfg.Schema.BuiltinPublicBase,
		SharedHosts:         cfg.Origins.SharedHosts,
		SchemaCacheSize:     cfg.Schema.LRUCacheSize,
		CrypterCacheSize:    cfg.Keys.CrypterLRUCacheSize,
		SigningKeyCacheSize: cfg.Keys.SigningKeyLRUCacheSize,
	})
	if err != nil {
		closePool()
		return migratev4.Deps{}, nil, err
	}
	return deps, closePool, nil
}
