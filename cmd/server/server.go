package server

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"github.com/zitadel/nextgen/internal/cookie"
	"github.com/zitadel/passwap"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/all"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func NewCommand() *cobra.Command {
	var configPath string

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Run the server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := loadConfig(configPath)
			if err != nil {
				return err
			}

			pool, err := startDatabase(cmd.Context(), cfg.Database)
			if err != nil {
				return err
			}

			return run(cmd.Context(), cfg, pool)
		},
	}

	cmd.Flags().StringVarP(&configPath, "config", "c", "", "Path to YAML configuration file")

	return cmd
}

func startDatabase(ctx context.Context, config database.Config) (database.Pool, error) {
	connector, err := config.Build()
	if err != nil {
		return nil, err
	}
	pool, err := connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	err = pool.Migrate(ctx)
	if err != nil {
		return nil, err
	}
	return pool, nil
}

func run(ctx context.Context, cfg Config, pool database.Pool) error {
	defer func() {
		if err := pool.Close(context.Background()); err != nil {
			log.Printf("close database pool: %v", err)
		}
	}()

	sealer, err := buildCookieSealer(cfg.Server.CookieSealerKey)
	if err != nil {
		return err
	}

	var passwordHasher *passwap.Swapper // TODO: initialize with actual configuration

	// ── Repositories ─────────────────
	projectRepo := repository.NewProjectRepository(pool)
	userRepo := repository.NewUserRepository()
	userPasswordRepo := repository.NewUserPasswordRepository()
	userPasskeyRepo := repository.NewUserPasskeyRepository()
	sessionRepo := repository.NewSessionRepository(pool)
	flowRepo := repository.NewFlowDefinitionRepository(pool)
	attemptRepo := repository.NewAuthAttemptRepository(pool)

	// ── Services ─────────────────────
	flowService := service.NewFlowService(pool, flowRepo)
	authAttemptSvc := service.NewAuthAttemptService(
		pool,
		attemptRepo,
		sessionRepo,
		projectRepo,
		userRepo,
		userPasswordRepo,
		userPasskeyRepo,
		passwordHasher,
	)
	sessionService := service.NewSessionService(pool, sessionRepo)

	// ── HTTP Server ─────────────────

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	oasServer, err := oasapi.NewServer(
		api.NewHandler(sealer, flowService, authAttemptSvc, sessionService),
		api.NewSecurityHandler(),
		oasapi.WithErrorHandler(api.OgenErrorHandler))
	if err != nil {
		return fmt.Errorf("build api server: %w", err)
	}

	httpServer := &http.Server{
		Addr:              cfg.Server.Address,
		Handler:           oasServer,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("server listening on %s", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
		close(serverErr)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown server: %w", err)
		}
		return nil
	case err := <-serverErr:
		return err
	}
}

func loadConfig(configPath string) (Config, error) {
	v := viper.New()
	v.SetEnvPrefix("NEXTGEN")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	v.SetDefault("server.address", ":8080")

	// AutomaticEnv only resolves nested keys viper already knows about
	// (via default, config file, or explicit BindEnv). Anything without
	// a default needs to be bound by hand.
	mustBindEnv(v, "server.cookie_sealer_key")

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

// mustBindEnv panics on viper's documented "this can't fail in
// normal use" BindEnv error path. Keeps the env wiring readable
// without sprinkling error handling at every binding.
func mustBindEnv(v *viper.Viper, key string) {
	if err := v.BindEnv(key); err != nil {
		panic(fmt.Errorf("bind env %q: %w", key, err))
	}
}

// buildCookieSealer decodes a hex-encoded sealer key and constructs
// the [cookie.Sealer]. The key must be exactly [cookie.KeySize] bytes
// after decoding; anything else is a configuration error.
func buildCookieSealer(hexKey string) (*cookie.Sealer, error) {
	if hexKey == "" {
		return nil, errors.New("server: cookie_sealer_key is required (set NEXTGEN_SERVER_COOKIE_SEALER_KEY)")
	}
	raw, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("server: decode cookie_sealer_key: %w", err)
	}
	if len(raw) != cookie.KeySize {
		return nil, fmt.Errorf("server: cookie_sealer_key must decode to %d bytes, got %d", cookie.KeySize, len(raw))
	}
	var key cookie.Key
	copy(key[:], raw)
	sealer, err := cookie.NewSealer(key)
	if err != nil {
		return nil, fmt.Errorf("server: build cookie sealer: %w", err)
	}
	return sealer, nil
}
