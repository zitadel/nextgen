package server

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
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
	slogctx "github.com/veqryn/slog-context"
	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/staticui/console"
	"github.com/zitadel/nextgen/internal/staticui/login"
	"github.com/zitadel/nextgen/internal/storage/database"
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/all"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
	v2db "github.com/zitadel/nextgen/internal/storage/v2/database"
	_ "github.com/zitadel/nextgen/internal/storage/v2/dialect/all"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"

	"github.com/zitadel/oidc/v3/pkg/op"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/log"
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
			return run(cmd.Context(), cfg, userFiles)
		},
	}

	cmd.Flags().StringVarP(&configPath, "config", "c", "", "Path to YAML configuration file")
	cmd.Flags().StringArrayVar(&userFiles, "user-file", nil, "Bootstrap user JSON file (repeatable)")

	return cmd
}

func run(ctx context.Context, cfg Config, userFiles []string) error {
	var err error
	sfs := &ShutdownFuncs{}
	defer func() {
		if err != nil {
			slog.Error("run error", slogctx.Err(err))
		}
		err = sfs.Exec(context.WithoutCancel(ctx))
		if err != nil {
			slog.Error("shutdown error", slogctx.Err(err))
			os.Exit(1)
			return
		}
		slog.Info("shut down application")
	}()

	slog.Info("building server")

	metrics, err := zotel.NewOtelMetrics(ctx, zotel.MetricsConfig{
		ServiceName:     cfg.Instrumentation.ServiceName,
		TraceIdFraction: cfg.Instrumentation.Trace.Fraction,
		TraceExporter:   cfg.Instrumentation.Trace.Exporter,
		MetricExporter:  cfg.Instrumentation.Metric.Exporter,
		LogExporter:     cfg.Instrumentation.Log.Exporter,
	})
	if err != nil {
		return fmt.Errorf("failed to create otel metrics: %w", err)
	}
	sfs.Add(metrics.Shutdown)

	setUpLogging(cfg.Instrumentation.Log, metrics.LoggerProvider())

	pool, v2Pool, err := startDatabase(ctx, cfg)
	if err != nil {
		return err
	}
	sfs.Add(func(ctx context.Context) error {
		if err := pool.Close(ctx); err != nil {
			return fmt.Errorf("failed close database pool: %w", err)
		}
		if err := v2Pool.Close(ctx); err != nil {
			return fmt.Errorf("failed close v2 database pool: %w", err)
		}
		return nil
	})

	kek, err := buildCrypter(cfg.Server.EncryptionKey)
	if err != nil {
		return fmt.Errorf("failed to create Crypter: %w", err)
	}

	passwordHasher, err := cfg.PasswordHasher.NewHasher()
	if err != nil {
		return fmt.Errorf("failed to build password hasher: %w", err)
	}

	// ── Repositories ─────────────────
	brandingRepo := repository.NewBrandingRepository(pool)

	serviceDBPool := service.NewPool(v2Pool.(service.Pool))
	schemaStore := serviceDBPool.Statements()
	sessionResolver := service.SessionStatementsResolver{Pool: serviceDBPool}

	if err := users.Import(ctx, pool, serviceDBPool, passwordHasher, users.DialectFromConfig(cfg.Database.Raw), userFiles); err != nil {
		return fmt.Errorf("failed to bootstrap users: %w", err)
	}

	// ── Schema Stuff ─────────────────
	schemaCache, err := lru.New2Q[string, *jsonschema.Schema](cfg.Schema.LRUCacheSize)
	if err != nil {
		return fmt.Errorf("failed to build schema cache: %w", err)
	}

	var builtinPublicBase *url.URL
	if cfg.Schema.BuiltinPublicBase != "" {
		builtinPublicBase, err = url.Parse(cfg.Schema.BuiltinPublicBase)
		if err != nil {
			return fmt.Errorf("failed to parse builtin public base: %w", err)
		}
	}

	schemaResolverWithHTTP := domain.NewJSONSchemaResolver(schemaCache, 10, 1000_000, &http.Client{}, builtinPublicBase)
	// storageSchemaResolver without an HTTP client to fetch tenant schemas from the cache/storage
	storageSchemaResolver := domain.NewJSONSchemaResolver(schemaCache, 10, 1000_000, nil, builtinPublicBase)
	schemaValidator, err := domain.NewSchemaValidator(builtinPublicBase.String())
	if err != nil {
		return fmt.Errorf("failed to build schema validator: %w", err)
	}

	userLookup := service.UserStatementsLookup{Pool: serviceDBPool}
	userIdentity := service.UserStatementsIdentityReader{Pool: serviceDBPool}

	// ── Services ─────────────────────
	keyService := service.NewKeyService(serviceDBPool, kek)

	authAttemptSvc := service.NewAuthAttemptService(
		pool,
		serviceDBPool,
		sessionResolver,
		userLookup,
		service.UserPasskeyStatementsStore{Pool: serviceDBPool},
		passwordHasher,
	)
	sessionService := service.NewSessionService(pool, serviceDBPool, userIdentity, service.SessionConfig{
		DefaultTTL: cfg.Session.DefaultTTL,
		MaxTTL:     cfg.Session.MaxTTL,
	})
	projectService := service.NewProjectService(
		serviceDBPool,
		builtinPublicBase.String(),
		schemaValidator,
		keyService,
	)
	schemaService := service.NewSchemaService(serviceDBPool, schemaResolverWithHTTP, schemaValidator)
	flowDefinitionSvc := service.NewFlowDefinitionService(
		serviceDBPool,
		schemaService,
		schemaValidator,
		nil,
	)
	teamService := service.NewTeamService(serviceDBPool)
	brandingService := service.NewBrandingService(pool, brandingRepo)
	userService := service.NewUserService(
		pool,
		serviceDBPool,
		schemaStore,
		passwordHasher,
	)

	// ── Flow engine ──────────────────
	ids := idgen.NewULID()
	fields := domain.NewSchemaFieldResolver()
	flowAuth := service.NewFlowAuthAttemptAdapter(authAttemptSvc)
	createUserHandler := service.NewFlowCreateUserHandler(
		passwordHasher,
		userService,
		schemaStore,
	)
	createUserForPasskeyHandler := service.NewFlowCreateUserForPasskeyHandler(userService, schemaStore)
	passkeyRegSvc := service.NewPasskeyRegistrationService(pool, serviceDBPool, ids)
	passkeyRegAdapter := service.NewFlowPasskeyRegistrationAdapter(passkeyRegSvc)
	stateMachine := domain.NewFlowStateMachine(
		storageSchemaResolver,
		schemaStore,
		fields,
		createUserHandler,
		createUserForPasskeyHandler,
		flowAuth,
		passkeyRegAdapter,
		ids,
		time.Now,
	)

	flowService := service.NewFlowService(pool, serviceDBPool, stateMachine, ids)
	tokenService := service.NewTokenService(keyService)

	// ── Default project resolution ──
	// Console ADR 0004 §3 (standalone): the deployment tracks exactly one
	// project — the one the customer's integration (`zitadel setup`) created
	// first. The server never creates it; it validates an explicitly pinned
	// id up front and otherwise reports the current state for operators.
	defaultProject, err := projectService.DefaultProject(ctx, cfg.Platform.ProjectID)
	if err != nil {
		return fmt.Errorf("failed to resolve the default project: %w", err)
	}
	if defaultProject != nil {
		slog.Info("default project resolved", slog.String("project_id", defaultProject.ID))
	} else {
		slog.Info("no project exists yet; the first project created (e.g. by `zitadel setup`) becomes the default")
	}

	// ── HTTP Server ─────────────────

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	oasServer, err := oasapi.NewServer(
		api.NewHandler(
			flowService,
			authAttemptSvc,
			sessionService,
			projectService,
			userService,
			schemaService,
			flowDefinitionSvc,
			teamService,
			brandingService,
			tokenService,
			keyService,
		),
		api.NewSecurityHandler(tokenService),
		oasapi.WithMiddleware(
			middleware.AddOperationIdToContext(),
			// logging is done at net/http level
		),
		oasapi.WithMeterProvider(metrics.MeterProvider()),
		oasapi.WithTracerProvider(metrics.TracerProvider()),
		oasapi.WithErrorHandler(api.OgenErrorHandler))
	if err != nil {
		return fmt.Errorf("failed to build api server: %w", err)
	}

	mux, err := buildHTTPMux(cfg.Server, idgen.NewULID(), oasServer,
		standaloneRuntimeResolver(projectService, keyService, cfg.Platform.ProjectID))
	if err != nil {
		return fmt.Errorf("failed to build http mux: %w", err)
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
		slog.Info("server listening for requests", slog.String("address", httpServer.Addr))
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
		slog.Debug("stopped listening")
		close(serverErr)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown server: %w", err)
		}
		slog.Info("server shut down")
		return nil
	case err := <-serverErr:
		return err
	}
}

// ----------------------------- CONFIG --------------------------------------

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
	// Default to argon2id (per ADR 029). Params follow the RFC 9106 second
	// recommended option (t=3, m=64 MiB, p=4), a good balance for servers.
	v.SetDefault("password_hasher.hasher.algorithm", crypto.HashNameArgon2id)
	v.SetDefault("password_hasher.hasher.time", 3)
	v.SetDefault("password_hasher.hasher.memory", 64*1024)
	v.SetDefault("password_hasher.hasher.threads", 4)
	// Keep bcrypt and legacy verifiers registered so pre-existing hashes still
	// validate and transparently rehash to argon2id on the next successful login.
	v.SetDefault("password_hasher.verifiers", []crypto.HashName{
		crypto.HashNameArgon2,
		crypto.HashNameBcrypt,
		crypto.HashNameScrypt,
		crypto.HashNamePBKDF2,
		crypto.HashNameSha2,
		crypto.HashNameMd5,
		crypto.HashNameMd5Salted,
		crypto.HashNamePHPass,
		crypto.HashNameDrupal7,
	})
	v.SetDefault("password_hasher.limits", crypto.HashLimitsConfig{
		Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16},
		Argon2: crypto.Argon2LimitsConfig{
			MinTime: 1, MaxTime: 10,
			MinMemory: 8 * 1024, MaxMemory: 512 * 1024,
			MinThreads: 1, MaxThreads: 16,
		},
	})
	v.SetDefault("schema.lru_cache_size", 1000)                                   // todo: temp, review
	v.SetDefault("schema.builtin_public_base", "https://nextgen.com/api/schemas") // todo: temp, review
	v.SetDefault("session.default_ttl", domain.SessionAnonymousTTL)
	v.SetDefault("session.max_ttl", 720*time.Hour)
	// Empty means "the deployment's first-created project is the default"
	// (Console ADR 0004 §3); set NEXTGEN_PLATFORM_PROJECT_ID to pin an
	// existing project instead. The server never creates a project itself.
	v.SetDefault("platform.project_id", "")
	v.SetDefault("instrumentation.service_name", "Zitadel")
	v.SetDefault("instrumentation.log.level", zlog.LevelInfo)
	v.SetDefault("instrumentation.log.streams", []zlog.Stream{
		zlog.StreamRuntime,
		zlog.StreamReady,
		zlog.StreamRequest,
		zlog.StreamService,
		zlog.StreamStorage,
	})
	v.SetDefault("instrumentation.log.format", instrumentation.LogFormatText)
	v.SetDefault("instrumentation.log.add_source", true)
	v.SetDefault("instrumentation.log.errors.report_location", true)
	v.SetDefault("instrumentation.log.errors.stack_trace", true)
	v.SetDefault("instrumentation.trace.fraction", 1.0)

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

// ----------------------------- HTTP --------------------------------------

func buildHTTPMux(cfg ServerConfig, reqIdGen idgen.Generator, apiHandler http.Handler, runtime runtimeResolver) (*http.ServeMux, error) {
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

		// Pre-session runtime metadata for the embedded console (Console
		// ADR 0004 §2). Registered as an exact path, so it wins over the
		// catch-all API mount below.
		mux.Handle(consoleRuntimePath, newConsoleRuntimeHandler(runtime))
	}

	mux.Handle("/",
		middleware.WithRequestIdentification(reqIdGen,
			middleware.WithLogging(
				api.WithRequestHostMiddleware(apiHandler),
			),
		),
	)
	return mux, nil
}

// ----------------------------- STORAGE --------------------------------------

func startDatabase(ctx context.Context, cfg Config) (database.Pool, v2db.Pool, error) {
	connector, dialect, err := buildDatabaseConnector(cfg)
	if err != nil {
		return nil, nil, err
	}
	pool, err := connector.Connect(ctx)
	if err != nil {
		return nil, nil, err
	}
	if dialect == nil {
		if p, ok := pool.(*embedded.Pool); ok {
			dialect = &postgres.PoolConfig{Pool: p.Pool.Pool}
		}
	}
	v2Pool, err := v2db.Connect(ctx, dialect)
	if err != nil {
		return nil, nil, err
	}
	err = pool.Migrate(ctx)
	if err != nil {
		return nil, nil, err
	}
	return pool, v2Pool, nil
}

func buildDatabaseConnector(cfg Config) (database.Connector, v2db.Dialect, error) {
	if len(cfg.Database.Raw) == 0 {
		options := embeddedPostgresOptions(cfg.Server.DataDir)
		slog.Info("no database dialect configured, starting embedded postgres", slog.String("filePath", filepath.Dir(options.DataPath)))
		return embedded.NewConnector(options), nil, nil
	}
	connector, err := cfg.Database.Build()
	if err != nil {
		return nil, nil, fmt.Errorf("build database connector: %w", err)
	}
	dialect, err := v2db.Config{Raw: cfg.Database.Raw}.Build()
	if err != nil {
		return nil, nil, fmt.Errorf("build database dialect: %w", err)
	}
	return connector, dialect, nil
}

func embeddedPostgresOptions(dataDir string) embedded.Options {
	root := filepath.Join(dataDir, "embedded-postgres")
	return embedded.Options{
		RuntimePath: filepath.Join(root, "runtime"),
		DataPath:    filepath.Join(root, "data"),
		CachePath:   filepath.Join(root, "cache"),
		LogPath:     filepath.Join(root, "postgres.log"),
		Logger:      os.Stdout,
	}
}

// ----------------------------- CRYPTO --------------------------------------

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
	crypter := op.NewAES256GCMCrypto([32]byte(key), "") // TODO: key id must be empty to match kek for now
	return crypter, nil
}

// ----------------------------- INSTRUMENTATION --------------------------------------

func setUpLogging(cfg instrumentation.LogConfig, otelProvider log.LoggerProvider) {
	errreport.EnableLocation(cfg.Errors.ReportLocation)
	errreport.EnableStack(cfg.Errors.StackTrace)
	errreport.GCPReporting(cfg.Format == instrumentation.LogFormatGCPErrorReporting)

	otelHandler := otelslog.NewHandler(
		Name,
		otelslog.WithLoggerProvider(otelProvider),
	)

	stdErrHandler := cfg.Format.ErrorHandler(cfg.SlogHandlerOptions())
	handler := zlog.NewHandler(
		cfg.Level,
		cfg.Streams,
		slog.NewMultiHandler(
			otelHandler,
			stdErrHandler,
		),
	)
	logger := zlog.NewLogger(handler)
	logger.Info("structured logger configured", "config_level", cfg.Level, "format", cfg.Format)
	slog.SetDefault(logger)
}
