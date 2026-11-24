package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/zitadel/nextgen/internal/bootstrap/platform"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/build"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// newSeedCommand is the server's seeding without the serving: what a
// deployment runs once as it deploys, after migrate, so that its instances
// start with --seed=false and write nothing. Unlike migrate it reads the
// master keys, which wrap the keys of the platform project it creates.
func newSeedCommand(configPath *string) *cobra.Command {
	var userFiles []string
	cmd := &cobra.Command{
		Use:           "seed",
		Short:         "Seed the database and exit",
		Long:          "Create the platform project and deploy the configuration the server ships for it (platform.bootstrap_project), import the bootstrap users and reconcile the platform operators, then exit. Run it after migrate, with the master key the servers are configured with; it changes nothing that is already in place.",
		Args:          noArguments,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			// Never a generated key: the seeding wraps the platform project's
			// keys with it and exits, and a key minted in a job's own data dir
			// is one the servers that start afterwards do not have.
			cfg, err := loadConfig(*configPath, func(v *viper.Viper) {
				v.Set("server.generate_master_key", false)
			})
			if errors.Is(err, errNoMasterKey) {
				return fmt.Errorf("seed never generates a master key, because the servers that start after it could not unwrap what it wrapped; give it the master key they are configured with: %w", err)
			}
			if err != nil {
				return err
			}
			return run(cmd.Context(), cfg, userFiles, phases{seed: true})
		},
	}
	cmd.Flags().StringArrayVar(&userFiles, "user-file", nil, "Bootstrap user JSON file (repeatable)")
	return cmd
}

// seeder is what a seeding writes through: the services of a server that is
// wired and not serving yet.
type seeder struct {
	pool         service.StatementPool
	projects     service.ProjectService
	releases     service.ReleaseService
	deployments  *service.DeploymentService
	hashes       crypto.HashValidator
	builtinBases domain.BuiltinSchemaBases
	// consoleOrigin is the origin of server.public_base, where the console
	// signs operators in to the platform project.
	consoleOrigin string
}

// seed writes what the configuration asks the database to hold: the platform
// project and the release the server ships for it, the bootstrap users, and
// the platform operators. Every step finds what an earlier seeding left and
// changes nothing that is in place, so it runs at every start of a server that
// seeds, on several replicas at once, and again in every deployment.
func (s seeder) seed(ctx context.Context, cfg Config, userFiles []string) error {
	// Before the user import: that import creates a bare project row for any
	// project id a bootstrap user names, and a row that already exists would
	// make this a no-op and leave the platform project without keys.
	if err := platform.Ensure(ctx, s.projects, s.pool, cfg.Platform.BootstrapProject); err != nil {
		return fmt.Errorf("failed to bootstrap platform project: %w", err)
	}
	// The console signs operators in to the platform project from the public
	// base, so that project serves a deployed release there like any other
	// project. Before the user import, which needs the platform user schema
	// this release stores.
	if cfg.Platform.BootstrapProject {
		if err := platform.EnsureDeployed(ctx, cfg.Schema.BuiltinPublicBase, build.Date(), s.consoleOrigin, cfg.OAuth.Enabled, s.projects, s.releases, s.deployments); err != nil {
			return fmt.Errorf("failed to deploy the platform project: %w", err)
		}
	}
	if err := users.Import(ctx, s.pool, s.hashes, users.DialectFromConfig(cfg.Database.Raw), s.builtinBases, userFiles); err != nil {
		return fmt.Errorf("failed to bootstrap users: %w", err)
	}
	// After the import, so a bootstrap admin named in platform.operators
	// exists by the time it is granted (ADR 075 §4).
	if err := platform.ReconcileOperators(ctx, s.pool, cfg.Platform.ResolvedProjectID(), cfg.Platform.Operators); err != nil {
		return fmt.Errorf("failed to reconcile platform operators: %w", err)
	}
	return nil
}
