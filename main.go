package main

import (
	"log"

	"github.com/zitadel/nextgen/cmd/server"
)

// version, commit, and date are populated at build time via -ldflags
// (see .goreleaser.yaml). cmd/server currently runs as the root command
// (below); these will feed the cobra root command once the root + `server`
// subcommand split lands.
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	_, _, _ = version, commit, date

	if err := server.NewCommand().Execute(); err != nil {
		log.Fatal(err)
	}
}
