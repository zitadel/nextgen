// embedded is used for testing purposes
package embedded

import (
	"log"
	"net"
	"os"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"

	// "github.com/zitadel/logging"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
)

func init() {
	database.MustRegisterDefaultConnector(new(Pool))
	// database.MustRegisterDialect("embedded", DecodeConfig)
}

// StartEmbedded starts an embedded postgres v16 instance and returns a database connector and a stop function
// the database is started on a random port and data are stored in a temporary directory
// its used for testing purposes only
func StartEmbedded() (connector database.Connector, stop func(), err error) {
	path, err := os.MkdirTemp("", "zitadel-embedded-postgres-*")
	if err != nil {
		return nil, nil, err
	}

	port, close := getPort()

	config := embeddedpostgres.DefaultConfig().Version(embeddedpostgres.V18).Port(uint32(port)).RuntimePath(path)
	embedded := embeddedpostgres.NewDatabase(config)

	close()
	err = embedded.Start()
	if err != nil {
		return nil, nil, err
	}

	connector, err = postgres.DecodeConfig(config.GetConnectionURL())
	if err != nil {
		return nil, nil, err
	}

	return connector, func() {
		err := embedded.Stop()
		if err != nil {
			log.Println("unable to stop embedded postgres")
		}
	}, nil
}

// getPort returns a free port and locks it until close is called
func getPort() (port uint16, close func()) {
	l, _ := net.Listen("tcp", ":0")
	// l, err := net.Listen("tcp", ":0")
	// logging.OnError(err).Fatal("unable to get port")
	port = uint16(l.Addr().(*net.TCPAddr).Port)
	// logging.WithFields("port", port).Info("Port is available")
	return port, func() {
		// logging.OnError(l.Close()).Error("unable to close port listener")
	}
}

func DecodeConfig(input any) (database.Connector, error) {
	panic("unimplemented")
}

var _ database.Connector = (*Pool)(nil)
