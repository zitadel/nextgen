package server

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/secrets"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/staticui/console"
	"github.com/zitadel/nextgen/internal/staticui/login"
	"github.com/zitadel/nextgen/internal/storage/database"
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/all"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
	"github.com/zitadel/oidc/v3/pkg/op"
)

func NewCommand() *cobra.Command {
	var configPath string
	var userFiles []string

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Run the server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := loadConfig(configPath)
			if err != nil {
				return err
			}

			pool, err := startDatabase(cmd.Context(), cfg)
			if err != nil {
				return err
			}

			return run(cmd.Context(), cfg, pool, userFiles)
		},
	}

	cmd.Flags().StringVarP(&configPath, "config", "c", "", "Path to YAML configuration file")
	cmd.Flags().StringArrayVar(&userFiles, "user-file", nil, "Bootstrap user JSON file (repeatable)")

	return cmd
}

func startDatabase(ctx context.Context, cfg Config) (database.Pool, error) {
	connector, err := buildDatabaseConnector(cfg)
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

func buildDatabaseConnector(cfg Config) (database.Connector, error) {
	if len(cfg.Database.Raw) == 0 {
		options := embeddedPostgresOptions(cfg.Server.DataDir)
		log.Printf("no database dialect configured, starting embedded postgres in %s", filepath.Dir(options.DataPath))
		return embedded.NewConnector(options), nil
	}
	return cfg.Database.Build()
}

func embeddedPostgresOptions(dataDir string) embedded.Options {
	root := filepath.Join(dataDir, "embedded-postgres")
	return embedded.Options{
		RuntimePath: filepath.Join(root, "runtime"),
		DataPath:    filepath.Join(root, "data"),
		LogPath:     filepath.Join(root, "postgres.log"),
		Logger:      os.Stdout,
	}
}

func run(ctx context.Context, cfg Config, pool database.Pool, userFiles []string) error {
	defer func() {
		if err := pool.Close(context.Background()); err != nil {
			log.Printf("close database pool: %v", err)
		}
	}()

	crypter, err := buildCrypter(cfg.Server.EncryptionKey)
	if err != nil {
		return err
	}

	passwordHasher, err := cfg.PasswordHasher.NewHasher()
	if err != nil {
		return fmt.Errorf("build password hasher: %w", err)
	}

	if err := users.Import(ctx, pool, passwordHasher, users.DialectFromConfig(cfg.Database.Raw), userFiles); err != nil {
		return fmt.Errorf("bootstrap users: %w", err)
	}

	// ── Repositories ─────────────────
	projectRepo := repository.NewProjectRepository(pool)
	userRepo := repository.NewUserRepository()
	userPasswordRepo := repository.NewUserPasswordRepository()
	userPasskeyRepo := repository.NewUserPasskeyRepository()
	passkeyRegRepo := repository.NewPasskeyRegistrationRepository()
	sessionRepo := repository.NewSessionRepository(pool)
	flowDefinitionRepo := repository.NewFlowDefinitionRepository(pool)
	attemptRepo := repository.NewAuthAttemptRepository(pool)
	schemaRepo := repository.NewJSONSchemaRepository(pool)
	teamRepo := repository.NewTeamRepository(pool)

	// ── Schema Stuff ─────────────────
	schemaCache, err := lru.New2Q[string, *jsonschema.Schema](cfg.Schema.LRUCacheSize)
	if err != nil {
		return fmt.Errorf("build schema cache: %w", err)
	}
	var builtinPublicBase *url.URL
	if cfg.Schema.BuiltinPublicBase != "" {
		builtinPublicBase, err = url.Parse(cfg.Schema.BuiltinPublicBase)
		if err != nil {
			return fmt.Errorf("parse builtin public base: %w", err)
		}
	}
	schemaResolverWithHTTP := domain.NewJSONSchemaResolver(schemaRepo, schemaCache, 10, 1000_000, &http.Client{}, builtinPublicBase)

	// storageSchemaResolver without an HTTP client to fetch tenant schemas from the cache/storage
	storageSchemaResolver := domain.NewJSONSchemaResolver(schemaRepo, schemaCache, 10, 1000_000, nil, builtinPublicBase)
	schemaValidator, err := domain.NewSchemaValidator(builtinPublicBase.String())
	if err != nil {
		return fmt.Errorf("build schema validator: %w", err)
	}

	// ── Services ─────────────────────
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
	sessionService := service.NewSessionService(pool, sessionRepo, service.SessionConfig{
		DefaultTTL: cfg.Session.DefaultTTL,
		MaxTTL:     cfg.Session.MaxTTL,
	})
	projectService := service.NewProjectService(
		pool,
		projectRepo,
		schemaRepo,
		flowDefinitionRepo,
		secrets.NewRandomSecretGenerator(),
		builtinPublicBase.String(),
		schemaValidator,
	)
	schemaService := service.NewSchemaService(pool, schemaRepo, schemaResolverWithHTTP, schemaValidator)
	flowDefinitionSvc := service.NewFlowDefinitionService(
		pool,
		storageSchemaResolver,
		schemaValidator,
		nil,
		flowDefinitionRepo,
	)
	userService := service.NewUserService(pool, userRepo, schemaRepo)
	teamService := service.NewTeamService(pool, teamRepo)

	// ── Flow engine ──────────────────
	ids := idgen.NewULID()
	fields := domain.NewSchemaFieldResolver(storageSchemaResolver)
	flowAuth := service.NewFlowAuthAttemptAdapter(authAttemptSvc)
	createUserHandler := domain.NewFlowCreateUserHandler(ids, userRepo, userPasswordRepo, passwordHasher)
	passkeyRegSvc := service.NewPasskeyRegistrationService(pool, passkeyRegRepo, userPasskeyRepo, ids)
	passkeyRegAdapter := service.NewFlowPasskeyRegistrationAdapter(passkeyRegSvc)
	stateMachine := domain.NewFlowStateMachine(fields, createUserHandler, flowAuth, passkeyRegAdapter, time.Now)

	flowService := service.NewFlowService(pool, flowDefinitionRepo, stateMachine, ids)

	// ── HTTP Server ─────────────────

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	oasServer, err := oasapi.NewServer(
		api.NewHandler(
			crypter,
			flowService,
			authAttemptSvc,
			sessionService,
			projectService,
			userService,
			schemaService,
			flowDefinitionSvc,
			teamService),
		api.NewSecurityHandler(),
		oasapi.WithErrorHandler(api.OgenErrorHandler))
	if err != nil {
		return fmt.Errorf("build api server: %w", err)
	}

	mux, err := buildHTTPMux(cfg.Server, oasServer)
	if err != nil {
		return err
	}

	httpServer := &http.Server{
		Addr:              cfg.Server.Address,
		Handler:           mux,
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
	v := viper.NewWithOptions(viper.ExperimentalBindStruct())
	v.SetEnvPrefix("NEXTGEN")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	dataDir, err := defaultServerDataDir()
	if err != nil {
		return Config{}, err
	}
	v.SetDefault("server.address", ":8080")
	v.SetDefault("server.data_dir", dataDir)
	v.SetDefault("server.console_enabled", true)
	v.SetDefault("server.console_path", "/ui/console")
	v.SetDefault("server.login_enabled", true)
	v.SetDefault("server.login_path", "/ui/login")
	v.SetDefault("password_hasher.hasher.algorithm", crypto.HashNameBcrypt)
	v.SetDefault("password_hasher.hasher.cost", 10)
	v.SetDefault("password_hasher.limits", crypto.HashLimitsConfig{
		Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16},
	})
	v.SetDefault("schema.lru_cache_size", 1000)                                   // todo: temp, review
	v.SetDefault("schema.builtin_public_base", "https://nextgen.com/api/schemas") // todo: temp, review
	v.SetDefault("session.default_ttl", domain.SessionAnonymousTTL)
	v.SetDefault("session.max_ttl", 720*time.Hour)

	// AutomaticEnv only resolves nested keys viper already knows about
	// (via default, config file, fields of config struct or explicit BindEnv).
	// We need to bind all possible env keys of fields which use `mapstructure:",remain"` to ensure they are resolved from env vars.
	for _, key := range database.DialectKeysForEnv() {
		mustBindEnv(v, "database."+key)
	}

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
		if configPath != "" || !errors.As(err, &notFound) {
			return Config{}, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if err := ensureServerEncryptionKey(&cfg.Server); err != nil {
		return Config{}, err
	}

	return cfg, cfg.Validate()
}

// mustBindEnv panics on viper's documented "this can't fail in
// normal use" BindEnv error path. Keeps the env wiring readable
// without sprinkling error handling at every binding.
func mustBindEnv(v *viper.Viper, key string) {
	if err := v.BindEnv(key); err != nil {
		panic(fmt.Errorf("bind env %q: %w", key, err))
	}
}

func buildHTTPMux(cfg ServerConfig, apiHandler http.Handler) (*http.ServeMux, error) {
	mux := http.NewServeMux()

	if cfg.LoginEnabled {
		if err := login.ValidateDist(); err != nil {
			return nil, err
		}
		loginHandler, err := login.Handler(cfg.LoginPath)
		if err != nil {
			return nil, fmt.Errorf("build login UI handler: %w", err)
		}
		mux.Handle(cfg.LoginPath, loginHandler)
		mux.Handle(cfg.LoginPath+"/", loginHandler)
	}

	if cfg.ConsoleEnabled {
		if err := console.ValidateDist(); err != nil {
			return nil, err
		}
		consoleHandler, err := console.Handler(cfg.ConsolePath)
		if err != nil {
			return nil, fmt.Errorf("build console UI handler: %w", err)
		}
		mux.Handle(cfg.ConsolePath, consoleHandler)
		mux.Handle(cfg.ConsolePath+"/", consoleHandler)
	}

	mux.Handle("/", api.WithRequestHostMiddleware(apiHandler))
	return mux, nil
}

// buildCrypter decodes a hex-encoded crypter key and constructs a
// [crypto.Crypter]. The key must decode to exactly 32 bytes;
// anything else is a configuration error.
func buildCrypter(hexKey string) (crypto.Crypter, error) {
	if hexKey == "" {
		return nil, errors.New("server: encryption_key is required (set NEXTGEN_SERVER_ENCRYPTION_KEY)")
	}
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("server: decode encryption_key: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("server: encryption_key must decode to %d bytes, got %d", 32, len(key))
	}
	crypter := op.NewAES256GCMCrypto([32]byte(key), "")
	return crypter, nil
}
