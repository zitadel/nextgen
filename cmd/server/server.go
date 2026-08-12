package server

import (
	"context"
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
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/log"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/bootstrap/platform"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/staticui/console"
	"github.com/zitadel/nextgen/internal/staticui/login"
	"github.com/zitadel/nextgen/internal/storage/database"
	_ "github.com/zitadel/nextgen/internal/storage/dialect/all"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite"
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

	pool, err := startDatabase(ctx, cfg)
	if err != nil {
		return err
	}
	sfs.Add(func(ctx context.Context) error {
		if err := pool.Close(ctx); err != nil {
			return fmt.Errorf("failed to close database pool: %w", err)
		}
		return nil
	})

	masterKey, err := buildMasterKey(cfg.Server.MasterKeys)
	if err != nil {
		return fmt.Errorf("failed to create Crypter: %w", err)
	}

	passwordHasher, err := cfg.PasswordHasher.NewHasher()
	if err != nil {
		return fmt.Errorf("failed to build password hasher: %w", err)
	}

	// ── Repositories ─────────────────
	serviceDBPool := service.NewPool(pool.(service.Pool))
	schemaStore := serviceDBPool.Statements()
	sessionResolver := service.SessionStatementsResolver{Pool: serviceDBPool}

	if err := platform.Ensure(ctx, serviceDBPool, cfg.Platform.BootstrapProject); err != nil {
		return fmt.Errorf("failed to bootstrap platform project: %w", err)
	}

	if err := users.Import(ctx, serviceDBPool, passwordHasher, users.DialectFromConfig(cfg.Database.Raw), userFiles); err != nil {
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
	keyService := service.NewKeyService(serviceDBPool, *masterKey)

	authAttemptSvc := service.NewAuthAttemptService(
		serviceDBPool,
		sessionResolver,
		userLookup,
		passwordHasher,
	)
	sessionService := service.NewSessionService(serviceDBPool, userIdentity, service.SessionConfig{
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
	brandingService := service.NewBrandingService(serviceDBPool)
	eventService := service.NewEventService(serviceDBPool)
	userService := service.NewUserService(
		serviceDBPool,
		schemaStore,
		passwordHasher,
	)

	// ── Flow engine ──────────────────
	fields := domain.NewSchemaFieldResolver()
	flowAuth := service.NewFlowAuthAttemptAdapter(authAttemptSvc)
	createUserHandler := service.NewFlowCreateUserHandler(
		passwordHasher,
		userService,
		schemaStore,
		serviceDBPool,
	)
	createUserForPasskeyHandler := service.NewFlowCreateUserForPasskeyHandler(userService, schemaStore)
	passkeyRegSvc := service.NewPasskeyRegistrationService(serviceDBPool)
	passkeyRegAdapter := service.NewFlowPasskeyRegistrationAdapter(passkeyRegSvc)
	stateMachine := domain.NewFlowStateMachine(
		storageSchemaResolver,
		schemaStore,
		fields,
		createUserHandler,
		createUserForPasskeyHandler,
		flowAuth,
		passkeyRegAdapter,
		time.Now,
	)

	flowService := service.NewFlowService(serviceDBPool, stateMachine)
	tokenService := service.NewTokenService(keyService, serviceDBPool)

	// ── Default project resolution ──
	// Console ADR 0004 §3 (standalone): the deployment tracks exactly one
	// project — the one the customer's integration (`zitadel setup`) created
	// first. The server never creates it; it validates an explicitly pinned
	// id up front and otherwise reports the current state for operators.
	defaultProject, err := projectService.DefaultProject(ctx, cfg.Platform.ResolvedProjectID())
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

	requestEventBuf := audit.NewRequestBuffer(audit.BatchInserter(func(ctx context.Context, events []*domain.Event) error {
		return serviceDBPool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			stmts := tx.Statements()
			for _, ev := range events {
				if err := stmts.InsertEvent(ctx, ev); err != nil {
					return err
				}
			}
			return nil
		})
	}), audit.DefaultRequestBufferConfig())
	defer requestEventBuf.Close()

	exportAdapter := service.EventExportAdapter{Pool: serviceDBPool}
	retentionCfg := audit.DefaultRetentionConfig()
	if cfg.Events.RetentionDays > 0 {
		retentionCfg.Retention = time.Duration(cfg.Events.RetentionDays) * 24 * time.Hour
	}
	if cfg.Events.RetentionEvery > 0 {
		retentionCfg.Interval = cfg.Events.RetentionEvery
	}
	retentionJob := audit.NewRetentionJob(exportAdapter, exportAdapter, retentionCfg)
	retentionJob.Start()
	defer retentionJob.Close()

	exportCfg := audit.DefaultExportConfig()
	exportCfg.Enabled = cfg.Events.ExportEnabled
	if cfg.Events.ExportEvery > 0 {
		exportCfg.Interval = cfg.Events.ExportEvery
	}
	for _, sc := range cfg.Events.Sinks {
		exportCfg.Sinks = append(exportCfg.Sinks, audit.SinkConfig{
			Type:    domain.EventSinkType(sc.Type),
			URL:     sc.URL,
			Enabled: sc.Enabled,
		})
	}
	shipper := audit.NewShipper(exportAdapter, exportCfg)
	if err := shipper.Start(ctx); err != nil {
		return fmt.Errorf("start event shipper: %w", err)
	}
	defer shipper.Close()

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
			eventService,
			tokenService,
			keyService,
			serviceDBPool,
			cfg.Platform.ProjectID,
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
		standaloneRuntimeResolver(projectService, tokenService, keyService, cfg.Platform.ResolvedProjectID()),
		requestEventBuf)
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

	// TODO: on a multi-replica deployment, the migration can happen multiple
	//       times. This is not a problem since the migration will not remove
	//       any keys. So nothing breaks. But there is no need to recompute the
	//       same thing multiple times.
	go func() {
		slog.Info("migrate keys to latest master key")
		if err := keyService.MigrateToLatestMasterKey(ctx); err != nil {
			slog.Error("error during master key migration", slog.Any(slogctx.ErrKey, err))
		}
		slog.Debug("master key migration done")
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
	// existing project instead. The server never creates a project itself,
	// unless platform.bootstrap_project explicitly opts in (#605).
	v.SetDefault("platform.project_id", "")
	v.SetDefault("platform.bootstrap_project", false)
	v.SetDefault("events.retention_days", 30)
	v.SetDefault("events.retention_interval", time.Hour)
	v.SetDefault("events.export_enabled", false)
	v.SetDefault("events.export_interval", 5*time.Second)
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
	if err := ensureServerMasterKey(&cfg.Server); err != nil {
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

func buildHTTPMux(cfg ServerConfig, reqIdGen middleware.RequestIDGenerator, apiHandler http.Handler, runtime runtimeResolver, requestEvents *audit.RequestBuffer) (*http.ServeMux, error) {
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

	// Pre-session runtime metadata for the embedded UI surfaces (Console
	// ADR 0004 §2). Named for the console, which carries it first, but it
	// describes the deployment — the default project and its publishable key
	// — and the hosted login shell resolves the project it signs into from
	// the same two fields, so it is mounted for either surface rather than
	// only alongside the console. Registered as an exact path, so it wins
	// over the catch-all API mount below.
	if cfg.ConsoleEnabled || cfg.LoginEnabled {
		mux.Handle(consoleRuntimePath, newConsoleRuntimeHandler(runtime))
	}

	mux.Handle("/",
		middleware.Chain(apiHandler,
			func(next http.Handler) http.Handler { return middleware.WithRequestContextMiddleware(reqIdGen, next) },
			middleware.WithLogging,
			api.WithRequestHostMiddleware,
			middleware.WithUserAgentMiddleware,
			api.WithSessionStateNoStore,
			func(next http.Handler) http.Handler { return audit.WithRequestEventMiddleware(requestEvents, next) },
		),
	)
	return mux, nil
}

// ----------------------------- STORAGE --------------------------------------

func startDatabase(ctx context.Context, cfg Config) (database.Pool, error) {
	dialect, err := buildDatabaseDialect(cfg)
	if err != nil {
		return nil, err
	}
	pool, err := database.Connect(ctx, dialect)
	if err != nil {
		return nil, err
	}
	if err := pool.Migrate(ctx); err != nil {
		return nil, err
	}
	return pool, nil
}

func buildDatabaseDialect(cfg Config) (database.Dialect, error) {
	if len(cfg.Database.Raw) == 0 {
		path := defaultSQLitePath(cfg.Server.DataDir)
		slog.Info("no database dialect configured, using sqlite", slog.String("path", path))
		return sqlite.Config{Path: path}, nil
	}

	dialect, err := cfg.Database.Build()
	if err != nil {
		return nil, fmt.Errorf("build database dialect: %w", err)
	}
	return dialect, nil
}

func defaultSQLitePath(dataDir string) string {
	return filepath.Join(dataDir, "zitadel.db")
}

// ----------------------------- CRYPTO --------------------------------------

func buildMasterKey(keyConfigs map[string]*MasterKeyConfig) (*domain.MasterKeys, error) {
	ks := make([]domain.MasterKey, 0, len(keyConfigs))
	for id, cfg := range keyConfigs {
		if cfg == nil || (cfg.PrivateKey == "" && cfg.File == "") {
			return nil, fmt.Errorf("server: either a private key or file must be provided (%s)", id)
		}

		raw := cfg.PrivateKey
		if raw == "" && cfg.File != "" {
			bs, err := os.ReadFile(cfg.File)
			if err != nil {
				return nil, fmt.Errorf("server: failed to read encryption key file %q: %w", cfg.File, err)
			}
			raw = string(bs)
		}

		key, err := crypto.ParseRSAKey(raw)
		if err != nil {
			return nil, fmt.Errorf("server: %w", err)
		}
		ks = append(ks, domain.NewMasterKey(
			id,
			*key,
			cfg.UseForEncryption,
		))
	}

	masterKeys, err := domain.NewMasterKeys(ks)
	if err != nil {
		return nil, fmt.Errorf("server: %w", err)
	}

	return masterKeys, nil
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
