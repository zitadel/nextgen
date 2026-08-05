package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

// consoleRuntimePath is where the embedded console discovers its pre-session
// runtime metadata (Console ADR 0004 §2). Served by the mux directly — like
// the static UI mounts, this is a console-internal contract, deliberately
// outside the OpenAPI product surface.
const consoleRuntimePath = "/console/runtime.json"

// ConsoleModeStandalone is the only deployment mode implemented today;
// platform (cloud portal) mode is future work tracked in Console ADR 0004.
const ConsoleModeStandalone = "standalone"

// consoleRuntime is the payload of GET /console/runtime.json. Every field is
// public runtime metadata in the root ADR 005 sense — ids and an enum, never
// secrets or feature inventories (per-surface gating rides effective
// permissions, Console ADR 0004 §4).
type consoleRuntime struct {
	// Mode is "standalone" or, in the future, "platform".
	Mode string `json:"mode"`
	// ConsoleProjectID is the one project the console signs into and
	// manages: the resolved default in standalone (Console ADR 0004 §3),
	// the platform project in future platform mode. Omitted while the
	// deployment has no project yet — the customer's integration
	// (`zitadel setup`) creates the first project, which becomes the
	// default.
	ConsoleProjectID string `json:"console_project_id,omitempty"`
	// PublishableKey is the default project's browser-safe, origin-scoped
	// public-plane bearer (root ADR 036: today's preview secret, promoted).
	// The console's login widget sends it on flow calls and the
	// body-delivered handoff exchange. Publishing it here is by design —
	// it carries `project.read` only and no management operation accepts
	// it (`internal/api/authz.go`).
	PublishableKey string `json:"publishable_key,omitempty"`
}

// runtimeResolver produces the current runtime document. Resolved per
// request: the default project changes when `zitadel setup` creates the
// deployment's first project, without a server restart.
type runtimeResolver func(ctx context.Context) (consoleRuntime, error)

// standaloneRuntimeResolver resolves the standalone runtime document from
// the deployment's default project (configured pin or first-created),
// including the project's publishable key derived from its token encryption key.
func standaloneRuntimeResolver(
	projects service.ProjectService,
	tokens service.TokenService,
	cfgProjectID string,
) runtimeResolver {
	return func(ctx context.Context) (consoleRuntime, error) {
		project, err := projects.DefaultProject(ctx, cfgProjectID)
		if err != nil {
			return consoleRuntime{}, err
		}
		meta := consoleRuntime{Mode: ConsoleModeStandalone}
		if project == nil {
			return meta, nil
		}
		meta.ConsoleProjectID = project.ID

		tkn := project.PreviewToken()
		publishableKey, err := tokens.GenerateJWE(ctx, tkn)
		if err != nil {
			return consoleRuntime{}, err
		}
		meta.PublishableKey = publishableKey
		return meta, nil
	}
}

// newConsoleRuntimeHandler serves the runtime document.
func newConsoleRuntimeHandler(resolve runtimeResolver) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		ctx := r.Context()
		meta, err := resolve(ctx)
		if err != nil {
			// This endpoint bootstraps the console: a failure here surfaces in
			// the browser as a blank sign-in screen with nothing to explain it,
			// and the causes are all server-side (default-project lookup, key
			// access, key derivation). Without this line the only signal is a
			// bare 500 in the access log.
			runtimeLogger(ctx).Error(
				"console runtime resolution failed",
				"path", consoleRuntimePath,
				"err", err,
			)
			http.Error(w, "failed to resolve console runtime metadata", http.StatusInternalServerError)
			return
		}
		body, err := json.Marshal(meta)
		if err != nil {
			runtimeLogger(ctx).Error(
				"console runtime encoding failed",
				"path", consoleRuntimePath,
				"err", err,
			)
			http.Error(w, "failed to encode console runtime metadata", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		// The document changes with deployment state (first project created,
		// config changes), so clients must not cache it across sessions.
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(body)
	})
}

// runtimeLogger is the request-scoped logger for the runtime endpoint. The
// handler is mounted on the bare mux (outside the API middleware chain), so
// the context carries no request id and this falls back to the default
// logger — the stream tag keeps the records grouped with request logging
// either way.
func runtimeLogger(ctx context.Context) *slog.Logger {
	return zlog.WithStream(zlog.GetLoggingContext(ctx), zlog.StreamRequest)
}
