// Command api is the cloud's control plane, the server side of the console in
// platform mode (docs/design/platform/cloud-plan-2026-10-09.md, item 5): what
// the product does not offer because only a cloud needs it. This first slice
// is the region directory and the placement of projects: which region a
// project lives in, and creating a project in a region on behalf of the
// signed-in person.
//
// It runs next to the identity home on the same host, under /cloud, with a
// schema of its own (cloud) in the home's database. It holds no users and
// no sessions: a request is authenticated by asking the home for the
// browser's session cookie (GET /sessions/me, cached a minute), the way a
// region does. A project is created in its region through the region's own
// API — the public create, the claim challenge with the one-time project
// secret, the completion with the person's session — and recorded here.
//
// Configuration is the environment the cloud's build writes for the function
// (apps/cloud/build-output.sh) plus the project's variables: PORT;
// CLOUD_DATABASE_URL_HOME and, for migrations, CLOUD_MIGRATOR_DATABASE_URL_HOME
// (the home's database; a `schema` parameter is ignored, every table is
// qualified with cloud.); CLOUD_REGIONS (the regions, JSON); CLOUD_HOST or
// Vercel's own variables (the host the home and the regions are called on);
// NEXTGEN_PLATFORM_HOME_URL (the home, default https://<host>);
// CLOUD_HOME_BYPASS_SECRET (sent as x-vercel-protection-bypass while the
// deployment is protected). Migrations run at startup, serialized by an
// advisory lock: this service owns one small schema and a start is the one
// moment it has.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg, err := configFromEnv()
	if err != nil {
		logger.Error("cloud api: configuration", "err", err)
		os.Exit(64)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate(ctx, cfg.MigratorURL); err != nil {
		logger.Error("cloud api: migrations", "err", err)
		os.Exit(1)
	}
	pool, err := openPool(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("cloud api: database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	srv := newServer(
		&pgStore{pool: pool},
		newHomeClient(cfg.HomeURL, cfg.Headers, time.Minute),
		newRegionClient(cfg.Regions, cfg.Host, cfg.Headers),
		logger,
	)
	logger.Info("cloud api: listening", "port", cfg.Port, "home", cfg.HomeURL, "regions", len(cfg.Regions))
	if err := http.ListenAndServe(":"+cfg.Port, srv); err != nil {
		fmt.Fprintln(os.Stderr, "cloud api:", err)
		os.Exit(1)
	}
}
