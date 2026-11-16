package server

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
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
