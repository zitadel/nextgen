package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags|log.Lmsgprefix)
	cfg := loadConfig()
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		logger.Fatal(err)
	}
	store, err := cell.OpenStore(filepath.Join(cfg.DataDir, "cell.db"), cfg.URL, cfg.Label, cfg.IsParent)
	if err != nil {
		logger.Fatal(err)
	}
	defer store.Close()

	srv := cell.NewServer(store, cell.NewPeerClient(), logger)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	meta, _ := store.GetMeta()
	if meta.ParentURL != "" && meta.JoinSecret != "" {
		srv.StartHeartbeatLoop(ctx)
	}

	httpSrv := &http.Server{Addr: cfg.Listen, Handler: srv.Handler()}
	go func() {
		logger.Printf("cell %s listening on %s url=%s parent=%v", cfg.Label, cfg.Listen, cfg.URL, cfg.IsParent)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal(err)
		}
	}()

	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdown)
}

type config struct {
	URL      string
	Label    string
	Listen   string
	DataDir  string
	IsParent bool
}

func loadConfig() config {
	isParent, _ := strconv.ParseBool(env("IS_PARENT", "false"))
	return config{
		URL:      mustEnv("CELL_URL"),
		Label:    env("CELL_LABEL", "cell"),
		Listen:   env("LISTEN_ADDR", ":8100"),
		DataDir:  env("DATA_DIR", "/data"),
		IsParent: isParent,
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("missing required env %s", k)
	}
	return v
}
