package main

import (
	"log/slog"
	"os"

	slogctx "github.com/veqryn/slog-context"

	"github.com/zitadel/nextgen/cmd/server"
)

func main() {
	if err := server.NewCommand().Execute(); err != nil {
		// Not log.Fatal: once the server has installed its slog default, the
		// log package is bridged into it at INFO and without a source, and an
		// instrumentation.log.level above that dropped the line, so a failed
		// start exited 1 with an empty log (#1409). slog.Error passes every
		// configured level and goes through the configured handler, so the
		// exit reason lands in the same sink as the rest of the run.
		slog.Error("exiting with error", slogctx.Err(err))
		os.Exit(1)
	}
}
