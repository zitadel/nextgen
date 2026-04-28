package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/signal"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	api "github.com/zitadel/nextgen/api/generated"
	handler "github.com/zitadel/nextgen/internal/api"
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/all"
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

			if len(cfg.Database.Raw) > 0 {
				_, err = cfg.Database.Build()
				if err != nil {
					return err
				}
			} else {
				log.Println("no database configured, skipping connection")
			}

			srv, err := api.NewServer(handler.NewHandler(), handler.NewSecurityHandler())
			if err != nil {
				return fmt.Errorf("create api server: %w", err)
			}

			addr := cfg.ListenAddr()
			httpServer := &http.Server{
				Addr:    addr,
				Handler: srv,
			}

			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			ln, err := net.Listen("tcp", addr)
			if err != nil {
				return fmt.Errorf("listen %s: %w", addr, err)
			}
			log.Printf("listening on %s", addr)

			errCh := make(chan error, 1)
			go func() { errCh <- httpServer.Serve(ln) }()

			select {
			case err := <-errCh:
				if errors.Is(err, http.ErrServerClosed) {
					return nil
				}
				return err
			case <-ctx.Done():
				log.Println("shutting down")
				return httpServer.Shutdown(context.Background())
			}
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
