package main

import (
	"log"

	"github.com/zitadel/nextgen/cmd/server"
)

// version, commit, and date are populated at build time via -ldflags
// (see .goreleaser.yaml) and consumed by the cobra root command that
// will be wired up together with the cmd/server subcommand.
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
