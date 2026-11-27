package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/ui"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags|log.Lmsgprefix)
	cells, err := ui.ParseCellsEnv(os.Getenv("CELLS"))
	if err != nil {
		logger.Fatal(err)
	}
	app, err := ui.NewApp(cells, logger)
	if err != nil {
		logger.Fatal(err)
	}
	addr := env("LISTEN_ADDR", ":3000")
	httpSrv := &http.Server{Addr: addr, Handler: app.Handler()}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		logger.Printf("ui listening on %s (%d cells)", addr, len(cells))
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdown)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
