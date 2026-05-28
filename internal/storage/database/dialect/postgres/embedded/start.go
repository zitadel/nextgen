// embedded is used for testing purposes
package embedded

import (
	"fmt"
	"log"
	"net"
	"os"
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

// StartEmbedded starts an embedded postgres v18 instance and returns a database connector and a stop function
// the database is started on a random port and data are stored in a temporary directory
// its used for testing purposes only
func StartEmbedded() (connector database.Connector, stop func(), err error) {
	// On a cold cache the embedded-postgres library downloads the binary from
	// Maven Central. That endpoint occasionally returns a transient non-200,
	// which the library misreports as "no version found matching <version>"
	// (the GET succeeds but the status check fails). Retry a few times so a
	// flaky download doesn't take down the whole test binary; startEmbeddedOnce
	// cleans up after itself on every error path, so each attempt starts fresh.
	const maxAttempts = 3
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		connector, stop, err = startEmbeddedOnce()
		if err == nil {
			return connector, stop, nil
		}
		if attempt < maxAttempts {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
	}
	return nil, nil, fmt.Errorf("embedded postgres failed after %d attempts: %w", maxAttempts, err)
}

func startEmbeddedOnce() (connector database.Connector, stop func(), err error) {
	path, err := os.MkdirTemp("", "zitadel-embedded-postgres-*")
	if err != nil {
		return nil, nil, fmt.Errorf("unable to create temp dir: %w", err)
	}

	port, releasePort, err := getPort()
	if err != nil {
		_ = os.RemoveAll(path)
		return nil, nil, fmt.Errorf("unable to get postgres port: %w", err)
	}

	config := embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V18).
		Port(uint32(port)).
		RuntimePath(path).
		// CI runners (GitHub Actions ubuntu) have throttled disk I/O; the
		// default 15s start timeout is enough on a Mac SSD but blows out
		// during initdb on cold runners. 60s gives plenty of headroom.
		StartTimeout(60 * time.Second).
		// Surface the postgres process's own stdout/stderr so a startup
		// failure (e.g. missing libc symbol on a runner) is visible in
		// the test log instead of silently hanging.
		Logger(os.Stdout)
	embedded := embeddedpostgres.NewDatabase(config)

	if err = releasePort(); err != nil {
		_ = os.RemoveAll(path)
		return nil, nil, fmt.Errorf("unable to release postgres port: %w", err)
	}
	if err = embedded.Start(); err != nil {
		_ = os.RemoveAll(path)
		return nil, nil, fmt.Errorf("unable to start db: %w", err)
	}

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
		_ = os.RemoveAll(path)
		return nil, nil, err
	}

	return connector, func() {
		err := embedded.Stop()
		if err != nil {
			log.Printf("unable to stop embedded postgres: %v", err)
		}
		_ = os.RemoveAll(path)
	}, nil
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
