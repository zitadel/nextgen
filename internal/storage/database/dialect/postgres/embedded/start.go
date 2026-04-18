// embedded is used for testing purposes
package embedded

import (
	"fmt"
	"net"
	"os"

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

	port, closePort, err := getPort()
	if err != nil {
		_ = os.RemoveAll(path)
		return nil, nil, fmt.Errorf("unable to get free port: %w", err)
	}

	config := embeddedpostgres.DefaultConfig().Version(embeddedpostgres.V16).Port(uint32(port)).RuntimePath(path)
	embedded := embeddedpostgres.NewDatabase(config)
	closePort()

	err = embedded.Start()
	if err != nil {
		_ = os.RemoveAll(path)
		return nil, nil, fmt.Errorf("unable to start embedded postgres: %w", err)
	}

	connector, err = postgres.DecodeConfig(config.GetConnectionURL())
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
func getPort() (port uint16, close func(), err error) {
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, nil, err
	}
	port = uint16(l.Addr().(*net.TCPAddr).Port)
	// logging.WithFields("port", port).Info("Port is available")
	return port, func() {
		_ = l.Close()
	}, nil
}
