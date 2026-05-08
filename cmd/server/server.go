package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"github.com/zitadel/nextgen/api/generated"
	internal_api "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/service"
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/all"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func NewCommand() *cobra.Command {
	var configPath string

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Run the server",
		RunE: func(_ *cobra.Command, _ []string) error {
			cfg, err := loadConfig(configPath)
			if err != nil {
				return err
			}

			ctx := context.Background()

			// ── Database ─────────────────────
			connector, err := cfg.Database.Build()
			if err != nil {
				return err
			}
			pool, err := connector.Connect(ctx)
			if err != nil {
				return err
			}
			err = pool.Migrate(ctx)
			if err != nil {
				return err
			}

			// ── Repositories ─────────────────
			projectRepo := &repository.Project{}
			userRepo := &repository.User{}
			userPasswordRepo := &repository.UserPasswordRepository{}
			userPasskeyRepo := &repository.UserPasskeyRepository{}
			sessionRepo := &repository.Session{}
			attemptRepo := &repository.AuthAttempt{}

			// ── Services ─────────────────────
			authAttemptSvc := service.NewAuthAttemptService(
				pool,
				attemptRepo,
				sessionRepo,
				projectRepo,
				userRepo,
				userPasswordRepo,
				userPasskeyRepo,
			)

			// ── HTTP handlers ─────────────────
			handler := internal_api.NewHandler(authAttemptSvc)

			server, err := api.NewServer(
				handler,
				internal_api.NewSecurityHandler(),
				api.WithErrorHandler(internal_api.OgenErrorHandler),
			)
			if err != nil {
				return err
			}
			err = http.ListenAndServe(":8080", server)
			if err != nil {
				return err
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&configPath, "config", "c", "", "Path to YAML configuration file")

	return cmd
}

func loadConfig(configPath string) (Config, error) {
	v := viper.New()
	v.SetEnvPrefix("NEXTGEN")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("nextgen")
		v.AddConfigPath(".")
		v.AddConfigPath("./config")
		v.AddConfigPath("/etc/nextgen")
	}

	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !(configPath == "" && errors.As(err, &notFound)) {
			return Config{}, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}

	return cfg, nil
}
