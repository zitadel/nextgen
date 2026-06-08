package embedded

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"

	// "github.com/zitadel/logging"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
)

func init() {
	database.MustRegisterDefaultConnector(new(Pool))
	// database.MustRegisterDialect("embedded", DecodeConfig)
}

// Options controls where embedded Postgres stores its runtime and data.
type Options struct {
	RuntimePath  string
	DataPath     string
	LogPath      string
	Logger       io.Writer
	RemoveOnStop bool
}

// StartEmbedded starts an embedded postgres v18 instance and returns a database connector and a stop function.
// The database is started on a random port and, by default, data is stored in a temporary directory.
// It is used by embedded-postgres smoke tests and callers that need isolated storage.
func StartEmbedded() (connector database.Connector, stop func(), err error) {
	return StartEmbeddedWithOptions(Options{})
}

// StartEmbeddedWithOptions starts embedded Postgres with explicit runtime/data paths.
// When DataPath is outside RuntimePath, Postgres data is reused across restarts.
func StartEmbeddedWithOptions(options Options) (connector database.Connector, stop func(), err error) {
	// On a cold cache the embedded-postgres library downloads the binary from
	// Maven Central. That endpoint occasionally returns a transient non-200,
	// which the library misreports as "no version found matching <version>"
	// (the GET succeeds but the status check fails). Retry a few times so a
	// flaky download doesn't take down the whole test binary; startEmbeddedOnce
	// cleans up after itself on every error path, so each attempt starts fresh.
	const maxAttempts = 3
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		connector, stop, err = startEmbeddedOnce(options)
		if err == nil {
			return connector, stop, nil
		}
		if attempt < maxAttempts {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
	}
	return nil, nil, fmt.Errorf("embedded postgres failed after %d attempts: %w", maxAttempts, err)
}

func startEmbeddedOnce(options Options) (connector database.Connector, stop func(), err error) {
	options, err = normalizeOptions(options)
	if err != nil {
		return nil, nil, err
	}

	port, releasePort, err := getPort()
	if err != nil {
		cleanupOptions(options)
		return nil, nil, fmt.Errorf("unable to get postgres port: %w", err)
	}

	config := embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V18).
		Port(uint32(port)).
		RuntimePath(options.RuntimePath).
		DataPath(options.DataPath).
		// CI runners (GitHub Actions ubuntu) have throttled disk I/O; the
		// default 15s start timeout is enough on a Mac SSD but blows out
		// during initdb on cold runners. 60s gives plenty of headroom.
		StartTimeout(60 * time.Second).
		// Surface the postgres process's own stdout/stderr so a startup
		// failure (e.g. missing libc symbol on a runner) is visible in
		// the test log instead of silently hanging.
		Logger(options.Logger)
	if options.LogPath != "" {
		if err := os.MkdirAll(filepath.Dir(options.LogPath), 0o700); err != nil {
			_ = releasePort()
			cleanupOptions(options)
			return nil, nil, fmt.Errorf("create postgres log directory: %w", err)
		}
		config = config.StartParameters(postgresLogStartParameters(options.LogPath))
	}
	embedded := embeddedpostgres.NewDatabase(config)

	if err = releasePort(); err != nil {
		cleanupOptions(options)
		return nil, nil, fmt.Errorf("unable to release postgres port: %w", err)
	}
	if err = embedded.Start(); err != nil {
		cleanupOptions(options)
		return nil, nil, fmt.Errorf("unable to start db: %w", err)
	}
	tailer := startFileTailer(options.LogPath, options.Logger)

	// Build the connection URL ourselves rather than calling
	// config.GetConnectionURL():
	//   - the library's URL hardcodes "localhost", which Go's resolver
	//     expands to both 127.0.0.1 and [::1]; the embedded postgres
	//     binary only listens on IPv4, so the [::1] attempt hangs.
	//   - sslmode=disable skips pgx's SSL probe (which on the linux
	//     embedded binary hangs the TLS handshake indefinitely).
	url := fmt.Sprintf("postgresql://postgres:postgres@127.0.0.1:%d/postgres?sslmode=disable", port)
	connector, err = postgres.DecodeConfig(url)
	if err != nil {
		_ = embedded.Stop()
		if tailer != nil {
			tailer.Stop()
		}
		cleanupOptions(options)
		return nil, nil, err
	}

	return connector, func() {
		err := embedded.Stop()
		if err != nil {
			log.Printf("unable to stop embedded postgres: %v", err)
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

	var (
		offset int64
	)
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

// getPort returns a free port and locks it until close is called
func getPort() (port uint16, close func() error, err error) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return 0, nil, err
	}
	port = uint16(l.Addr().(*net.TCPAddr).Port)
	// logging.WithFields("port", port).Info("Port is available")
	return port, l.Close, nil
}

func DecodeConfig(input any) (database.Connector, error) {
	return nil, fmt.Errorf("embedded postgres config decoding is not implemented")
}

var _ database.Connector = (*Pool)(nil)
