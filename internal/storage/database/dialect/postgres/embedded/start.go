// embedded is used for testing purposes
package embedded

import (
	"fmt"
	"net"
	"os"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"

	// "github.com/zitadel/logging"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
)

// StartEmbedded starts an embedded postgres v16 instance and returns a database connector and a stop function
// the database is started on a random port and data are stored in a temporary directory
// its used for testing purposes only
func StartEmbedded() (connector database.Connector, stop func(), err error) {
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
		Version(embeddedpostgres.V16).
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
		_ = embedded.Stop()
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
