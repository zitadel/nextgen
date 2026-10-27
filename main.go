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
		// log package is bridged into it at INFO and without a source, which
		// a warn level drops, so a failed start exited 1 with no record of
		// why (#1409). slog.Error writes at ERROR through the configured
		// handler, so the exit reason lands in the same sink as the rest of
		// the run and clears a warn or error threshold.
		slog.Error("exiting with error", slogctx.Err(err))
		os.Exit(1)
	}
}
