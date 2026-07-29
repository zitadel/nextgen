package embedded

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	slogctx "github.com/veqryn/slog-context"

	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

// Options controls where embedded Postgres stores its runtime and data.
type Options struct {
	RuntimePath  string
	DataPath     string
	CachePath    string
	LogPath      string
	Logger       io.Writer
	RemoveOnStop bool
}

// Dialect is a v2 database dialect that starts an embedded Postgres instance
// on first Connect and returns a connected v2 postgres pool.
type Dialect struct {
	options Options
}

func NewDialect(options Options) *Dialect {
	return &Dialect{options: options}
}

// Name implements [v2database.Dialect].
func (d *Dialect) Name() string {
	return "postgres-embedded"
}

// Connect implements [v2database.Dialect].
func (d *Dialect) Connect(ctx context.Context) (v2database.Pool, error) {
	pool, stop, err := startEmbeddedOnce(ctx, d.options)
	if err != nil {
		return nil, err
	}
	return &poolWithStop{Pool: pool, stop: stop}, nil
}

// poolWithStop closes the v2 postgres pool and then stops the embedded server.
type poolWithStop struct {
	*v2postgres.Pool
	stop func()
}

func (p *poolWithStop) Close(ctx context.Context) error {
	err := p.Pool.Close(ctx)
	p.stop()
	return err
}

func startEmbeddedOnce(ctx context.Context, options Options) (pool *v2postgres.Pool, stop func(), err error) {
	options, err = normalizeOptions(options)
	if err != nil {
		return nil, nil, err
	}

	port, releasePort, err := getPort()
	if err != nil {
		cleanupOptions(options)
		return nil, nil, fmt.Errorf("unable to get postgres port: %w", err)
	}

	cfg := embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V18).
		Port(uint32(port)).
		CachePath(options.CachePath).
		RuntimePath(options.RuntimePath).
		DataPath(options.DataPath).
		// CI runners (GitHub Actions ubuntu) have throttled disk I/O; increase
		// the start timeout to allow initdb to complete.
		StartTimeout(60 * time.Second).
		Logger(options.Logger)

	var tailer *fileTailer
	if options.LogPath != "" {
		if err := os.MkdirAll(filepath.Dir(options.LogPath), 0o700); err != nil {
			_ = releasePort()
			cleanupOptions(options)
			return nil, nil, fmt.Errorf("create postgres log directory: %w", err)
		}
		cfg = cfg.StartParameters(postgresLogStartParameters(options.LogPath))
		tailer = startFileTailer(options.LogPath, options.Logger)
	}

	embedded := embeddedpostgres.NewDatabase(cfg)
	if err = releasePort(); err != nil {
		cleanupOptions(options)
		return nil, nil, fmt.Errorf("unable to release postgres port: %w", err)
	}
	if err = embedded.Start(); err != nil {
		cleanupOptions(options)
		return nil, nil, fmt.Errorf("unable to start db: %w", err)
	}

	// Ensure the database can be reached using IPv4 only and without SSL probing
	// (otherwise the TLS handshake can hang indefinitely on the embedded binary).
	url := fmt.Sprintf("postgresql://postgres:postgres@127.0.0.1:%d/postgres?sslmode=disable", port)
	dialect, err := v2postgres.DecodeConfig(url)
	if err != nil {
		_ = embedded.Stop()
		if tailer != nil {
			tailer.Stop()
		}
		cleanupOptions(options)
		return nil, nil, err
	}
	poolAny, err := dialect.Connect(ctx)
	if err != nil {
		_ = embedded.Stop()
		if tailer != nil {
			tailer.Stop()
		}
		cleanupOptions(options)
		return nil, nil, err
	}
	pool, ok := poolAny.(*v2postgres.Pool)
	if !ok {
		_ = poolAny.Close(ctx)
		_ = embedded.Stop()
		if tailer != nil {
			tailer.Stop()
		}
		cleanupOptions(options)
		return nil, nil, fmt.Errorf("expected *v2postgres.Pool, got %T", poolAny)
	}

	return pool, func() {
		if err := embedded.Stop(); err != nil {
			slog.Error("unable to stop embedded postgres", slogctx.Err(err))
		}
		if tailer != nil {
			tailer.Stop()
		}
		cleanupOptions(options)
	}, nil
}

func normalizeOptions(options Options) (Options, error) {
	if options.Logger == nil {
		options.Logger = os.Stdout
	}
	if options.RuntimePath == "" && options.DataPath == "" {
		path, err := os.MkdirTemp("", "zitadel-embedded-postgres-*")
		if err != nil {
			return Options{}, fmt.Errorf("unable to create temp dir: %w", err)
		}
		options.RuntimePath = path
		options.DataPath = filepath.Join(path, "data")
		options.RemoveOnStop = true
		return options, nil
	}
	if options.RuntimePath == "" {
		options.RuntimePath = filepath.Join(filepath.Dir(options.DataPath), "runtime")
	}
	if options.DataPath == "" {
		options.DataPath = filepath.Join(options.RuntimePath, "data")
	}
	if options.CachePath == "" {
		options.CachePath = filepath.Join(filepath.Dir(options.RuntimePath), "cache")
	}
	return options, nil
}

func cleanupOptions(options Options) {
	if options.RemoveOnStop {
		_ = os.RemoveAll(options.RuntimePath)
	}
}

func postgresLogStartParameters(logPath string) map[string]string {
	return map[string]string{
		"log_destination":          "stderr",
		"logging_collector":        "on",
		"log_directory":            filepath.Dir(logPath),
		"log_filename":             filepath.Base(logPath),
		"log_truncate_on_rotation": "on",
		"log_rotation_age":         "0",
		"log_rotation_size":        "0",
	}
}

type fileTailer struct {
	path   string
	writer io.Writer
	done   chan struct{}
	closed chan struct{}
}

func startFileTailer(path string, writer io.Writer) *fileTailer {
	if path == "" || writer == nil {
		return nil
	}
	tailer := &fileTailer{
		path:   path,
		writer: writer,
		done:   make(chan struct{}),
		closed: make(chan struct{}),
	}
	go tailer.run()
	return tailer
}

func (t *fileTailer) Stop() {
	close(t.done)
	<-t.closed
}

func (t *fileTailer) run() {
	defer close(t.closed)

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	var offset int64
	flush := func() {
		file, err := os.Open(t.path)
		if err != nil {
			return
		}
		defer file.Close()

		stat, err := file.Stat()
		if err != nil {
			return
		}
		if stat.Size() < offset {
			offset = 0
		}
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			return
		}
		written, err := io.Copy(t.writer, file)
		if err != nil {
			return
		}
		offset += written
	}

	for {
		select {
		case <-t.done:
			flush()
			return
		case <-ticker.C:
			flush()
		}
	}
}

// getPort returns a free port and locks it until close is called.
func getPort() (port uint16, close func() error, err error) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return 0, nil, err
	}
	port = uint16(l.Addr().(*net.TCPAddr).Port)
	return port, l.Close, nil
}
