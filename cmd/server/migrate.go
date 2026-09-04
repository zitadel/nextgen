package server

import (
	"context"
	"log/slog"

	"github.com/spf13/cobra"
)

func newMigrateCommand(configPath *string) *cobra.Command {
	return &cobra.Command{
		Use:          "migrate",
		Short:        "Apply database migrations and exit",
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := loadConfig(*configPath)
			if err != nil {
				return err
			}
			return migrateDatabase(cmd.Context(), cfg)
		},
	}
}

func migrateDatabase(ctx context.Context, cfg Config) error {
	pool, err := startDatabase(ctx, cfg, true)
	if err != nil {
		return err
	}
	slog.Info("database migrations applied")
	return pool.Close(ctx)
}
