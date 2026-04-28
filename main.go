package main

import (
	"log"

	"github.com/spf13/cobra"
	initcmd "github.com/zitadel/nextgen/cmd/init"
	"github.com/zitadel/nextgen/cmd/server"
	"github.com/zitadel/nextgen/cmd/setup"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	root := &cobra.Command{
		Use:     "nextgen",
		Short:   "Zitadel nextgen",
		Version: version,
	}

	root.AddCommand(server.NewCommand())
	root.AddCommand(initcmd.NewCommand())
	root.AddCommand(setup.NewCommand())

	if err := root.Execute(); err != nil {
		log.Fatal(err)
	}
}
