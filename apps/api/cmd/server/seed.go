package server

import (
	"github.com/spf13/cobra"
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
		Long:          "Create the platform project and deploy the configuration the server ships for it (platform.bootstrap_project), import the bootstrap users and reconcile the platform operators, then exit. Run it after migrate; it changes nothing that is already in place.",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			overrides, err := flagOverrides(cmd.Flags())
			if err != nil {
				return err
			}
			cfg, err := loadConfig(*configPath, overrides...)
			if err != nil {
				return err
			}
			return run(cmd.Context(), cfg, userFiles, phases{seed: true})
		},
	}
	cmd.Flags().StringArrayVar(&userFiles, "user-file", nil, "Bootstrap user JSON file (repeatable)")
	cmd.Flags().Bool(flagDisableMasterKeyGeneration, false,
		"Fail instead of generating a master key when none is configured (server.generate_master_key: false)")
	return cmd
}
