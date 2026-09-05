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
	"reflect"
	"strings"
	"syscall"
	"time"

	"github.com/go-viper/mapstructure/v2"
	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
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

// flagDisableMasterKeyGeneration is the command-line half of
// server.generate_master_key. It is spelled as the negative because that is
// what an operator reaches for: generation is on by default, and this turns a
// silent "a key was minted for you" into a startup failure.
const flagDisableMasterKeyGeneration = "disable-master-key-generation"

func NewCommand() *cobra.Command {
	var configPath string
	var userFiles []string

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Run the server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			overrides, err := flagOverrides(cmd.Flags())
			if err != nil {
				return err
			}
			cfg, err := loadConfig(configPath, overrides...)
			if err != nil {
				return err
			}
			return run(cmd.Context(), cfg, userFiles)
		},
	}

	cmd.Flags().StringVarP(&configPath, "config", "c", "", "Path to YAML configuration file")
	cmd.Flags().StringArrayVar(&userFiles, "user-file", nil, "Bootstrap user JSON file (repeatable)")
	cmd.Flags().Bool(flagDisableMasterKeyGeneration, false,
		"Fail the start instead of generating a master key when none is configured (server.generate_master_key: false)")

	return cmd
}

// flagOverrides turns the flags that shadow a configuration key into config
// overrides. Only a flag the operator actually passed becomes one, so an
// untouched flag leaves the config file and the environment in charge of the
// key it shadows.
func flagOverrides(flags *pflag.FlagSet) ([]configOverride, error) {
	var overrides []configOverride

	if flags.Changed(flagDisableMasterKeyGeneration) {
		disabled, err := flags.GetBool(flagDisableMasterKeyGeneration)
		if err != nil {
			return nil, fmt.Errorf("read --%s: %w", flagDisableMasterKeyGeneration, err)
		}
		overrides = append(overrides, func(v *viper.Viper) {
			v.Set("server.generate_master_key", !disabled)
		})
	}

	return overrides, nil
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
	userRefs := service.StatementsUserRefResolver{Pool: serviceDBPool}

	// ── Services ─────────────────────
	keyService := service.NewKeyService(serviceDBPool, *masterKey)

	authAttemptSvc := service.NewAuthAttemptService(
		serviceDBPool,
		sessionResolver,
		userLookup,
		passwordHasher,
	)
	sessionService := service.NewSessionService(serviceDBPool, userRefs, service.SessionConfig{
		DefaultTTL: cfg.Session.DefaultTTL,
		MaxTTL:     cfg.Session.MaxTTL,
	})
	projectService := service.NewProjectService(
		serviceDBPool,
		builtinPublicBase.String(),
		schemaValidator,
		keyService,
	)

	// Bootstrap runs here rather than straight after the migrations because it
	// now seeds a usable project (keys, user schema, login flows) and so needs
	// the project service, which needs the key service. It must still precede
	// the user import: that import creates a bare, unseeded project row for any
	// project id a bootstrap user names, and a project row that already exists
	// would make this a no-op and leave the platform project unseeded.
	if err := platform.Ensure(ctx, projectService, serviceDBPool, cfg.Platform.BootstrapProject); err != nil {
		return fmt.Errorf("failed to bootstrap platform project: %w", err)
	}

	if err := users.Import(ctx, serviceDBPool, passwordHasher, users.DialectFromConfig(cfg.Database.Raw), userFiles); err != nil {
		return fmt.Errorf("failed to bootstrap users: %w", err)
	}

	schemaService := service.NewSchemaService(serviceDBPool, schemaResolverWithHTTP, schemaValidator)
	flowDefinitionSvc := service.NewFlowDefinitionService(
		serviceDBPool,
		schemaService,
		schemaValidator,
		nil,
	)
	teamService := service.NewTeamService(serviceDBPool)
	// The claim and dashboard URLs hang off the console, reached at the
	// deployment's public base (not at schema.builtin_public_base, which is an
	// identifier namespace and must not follow the deployment address).
	consoleBase, err := consoleBaseURL(cfg.Server.PublicBase, cfg.Server.ConsolePath)
	if err != nil {
		return err
	}
	claimService := service.NewClaimService(serviceDBPool, consoleBase, cfg.Platform.ResolvedProjectID())
	grantService := service.NewGrantService(serviceDBPool, cfg.Platform.ResolvedProjectID())
	brandingService := service.NewBrandingService(serviceDBPool)
	environmentService := service.NewEnvironmentService(serviceDBPool)
	eventService := service.NewEventService(serviceDBPool)
	userService := service.NewUserService(
		serviceDBPool,
		schemaStore,
		passwordHasher,
		service.StatementsUserRefResolver{Pool: serviceDBPool},
	)

	// The platform project's registration side effect (#527): every flow-created
	// user on the platform project gets their personal team — the team
	// claim/complete attaches projects to — ensured idempotently. Gated on the
	// explicit bootstrap opt-in, never the standalone pin: a pinned deployment's
	// end-user registrations must not silently mint teams (#605, #736). Note the
	// deliberate asymmetry with claimService above, which resolves the pin —
	// a pinned deployment can attempt claims but is never auto-provisioned.
	personalTeams := service.NewPersonalTeamService(
		serviceDBPool,
		cfg.Platform.ProvisioningProjectID(),
	)

	// ── Flow engine ──────────────────
	fields := domain.NewSchemaFieldResolver()
	flowAuth := service.NewFlowAuthAttemptAdapter(authAttemptSvc, schemaStore)
	createUserHandler := service.NewFlowCreateUserHandler(
		passwordHasher,
		userService,
		schemaStore,
		serviceDBPool,
	)
	stateMachine := domain.NewFlowStateMachine(
		storageSchemaResolver,
		schemaStore,
		fields,
		createUserHandler,
		flowAuth,
		time.Now,
	)

	flowService := service.NewFlowService(serviceDBPool, stateMachine)
	tokenService := service.NewTokenService(keyService, serviceDBPool)

	// ── Default project resolution ──
	// Console ADR 0004 §2's cutover rule: until a human-usable seed transport
	// ships, the console's sign-in project is the explicitly pinned one, or
	// else the project the customer's integration (`zitadel setup`) created
	// first. This is the transitional fallback, not a one-project ceiling —
	// §1 is explicit that the data model does not enforce one. The server
	// never creates it; it validates an explicitly pinned id up front and
	// otherwise reports the current state for operators.
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

	exportAdapter := service.EventExportAdapter{Pool: serviceDBPool}
	requestEventBuf := audit.NewRequestBuffer(exportAdapter, audit.DefaultRequestBufferConfig())
	defer requestEventBuf.Close()

	retentionJob := audit.NewRetentionJob(exportAdapter, cfg.Events.Retention)
	retentionJob.Start()
	defer retentionJob.Close()

	shipper := audit.NewShipper(exportAdapter, cfg.Events.Export)
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
			environmentService,
			eventService,
			tokenService,
			keyService,
			claimService,
			grantService,
			serviceDBPool,
			// Resolved, not the raw pin: in bootstrap mode project_id is empty
			// and an empty handler pin rejects every claim/complete session.
			cfg.Platform.ResolvedProjectID(),
		).WithPersonalTeamEnsurer(personalTeams),
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

// consoleBaseURL joins the deployment's public base with the console mount
// path. The public base may carry a path prefix (a proxy mounting the server
// under a subpath) but nothing else: query, fragment, or userinfo would leak
// into every minted claim and dashboard URL, so misconfiguration fails at
// startup instead. The result never ends in a slash — callers append paths.
func consoleBaseURL(publicBase, consolePath string) (string, error) {
	base, err := url.Parse(publicBase)
	if err != nil {
		return "", fmt.Errorf("failed to parse server public base: %w", err)
	}
	if (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return "", fmt.Errorf("server public base %q must be an absolute http(s) URL", publicBase)
	}
	if base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return "", fmt.Errorf("server public base %q must carry only an origin and an optional path prefix", publicBase)
	}
	if consolePath != "" && !strings.HasPrefix(consolePath, "/") {
		return "", fmt.Errorf("server console path %q must start with a slash", consolePath)
	}
	base.Path = strings.TrimRight(base.Path, "/") + strings.TrimRight(consolePath, "/")
	return base.String(), nil
}

// ----------------------------- CONFIG --------------------------------------

// configOverride sets a value that outranks the config file and the
// environment, which is what a command-line flag has to do.
type configOverride func(*viper.Viper)

func loadConfig(configPath string, overrides ...configOverride) (Config, error) {
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
	v.SetDefault("server.public_base", "https://nextgen.zitadel.cloud")
	v.SetDefault("server.login_enabled", true)
	v.SetDefault("server.login_path", "/ui/login")
	// Generation on by default: a first local start has to work with no
	// configuration at all. Production turns it off, per ADR 029.
	v.SetDefault("server.generate_master_key", true)
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
	// (Console ADR 0004 §2); set NEXTGEN_PLATFORM_PROJECT_ID to pin an
	// existing project instead. The server never creates a project itself,
	// unless platform.bootstrap_project explicitly opts in (#605).
	v.SetDefault("platform.project_id", "")
	v.SetDefault("platform.bootstrap_project", false)
	v.SetDefault("events.retention.window", 30*24*time.Hour)
	v.SetDefault("events.retention.interval", time.Hour)
	v.SetDefault("events.retention.enabled", true)
	v.SetDefault("events.export.enabled", false)
	v.SetDefault("events.export.interval", 5*time.Second)
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

	// Last, so a flag outranks both the file and the environment.
	for _, override := range overrides {
		override(v)
	}

	warnIgnoredMasterKeyEnv(os.Environ())

	var cfg Config
	if err := v.Unmarshal(&cfg, viper.DecodeHook(mapstructure.ComposeDecodeHookFunc(
		// viper's own defaults (see viper.DecodeHook's doc comment) — lost if
		// not restated here, since DecodeHook overrides rather than extends them.
		// stringToWeakSliceHookFunc mirrors viper's own unexported hook of the
		// same name: mapstructure.StringToSliceHookFunc only fires for a
		// []string target, which would silently stop comma-separated env vars
		// (e.g. NEXTGEN_INSTRUMENTATION_LOG_STREAMS=request,service) from
		// reaching non-string slice fields such as []zlog.Stream.
		mapstructure.StringToTimeDurationHookFunc(),
		stringToWeakSliceHookFunc(","),
		// Lets enum types generated by enumer (zlog.Level, zlog.Stream,
		// instrumentation.LogFormat, ...) decode from their documented string
		// names via the encoding.TextUnmarshaler they already implement.
		mapstructure.TextUnmarshallerHookFunc(),
	))); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	// Create the data dir configuration actually selected, not the default
	// computed above — an explicit empty data_dir still means the default.
	if cfg.Server.DataDir == "" {
		cfg.Server.DataDir = dataDir
	}
	if err := ensureServerDataDir(cfg.Server.DataDir); err != nil {
		return Config{}, err
	}
	if err := ensureServerMasterKey(&cfg.Server); err != nil {
		return Config{}, err
	}

	return cfg, cfg.Validate()
}

// stringToWeakSliceHookFunc splits a string into a slice on sep, without
// requiring the target slice's element type to be string — matching
// viper's own unexported hook of the same name (spf13/viper's
// stringToWeakSliceHookFunc in viper.go), which viper.DecodeHook drops
// unless it's restated alongside any custom hooks.
func stringToWeakSliceHookFunc(sep string) mapstructure.DecodeHookFunc {
	return func(f reflect.Type, t reflect.Type, data any) (any, error) {
		if f.Kind() != reflect.String || t.Kind() != reflect.Slice {
			return data, nil
		}
		raw := data.(string)
		if raw == "" {
			return []string{}, nil
		}
		return strings.Split(raw, sep), nil
	}
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
	// ADR 0004 §3). Named for the console, which carries it first, but it
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
