package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

// consoleRuntimePath is where the embedded console discovers its pre-session
// runtime metadata (Console ADR 0004 §3). Served by the mux directly — like
// the static UI mounts, this is a console-internal contract, deliberately
// outside the OpenAPI product surface.
const consoleRuntimePath = "/console/runtime.json"

// The deployment modes of the runtime document (Console ADR 0004 §6):
// standalone, the default, and platform, the identity home of a cloud, which
// names its regions so the console manages projects across them.
const (
	ConsoleModeStandalone = "standalone"
	ConsoleModePlatform   = "platform"
)

// consoleRegion is a region of the cloud as the console learns it: public
// runtime metadata, an id, a name and the API base of the region.
type consoleRegion struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	APIBase string `json:"api_base"`
}

// consoleRuntime is the payload of GET /console/runtime.json. Every field is
// public runtime metadata in the root ADR 005 sense — ids and an enum, never
// secrets or feature inventories (per-surface gating rides effective
// permissions, Console ADR 0004 §5).
type consoleRuntime struct {
	// Mode is "standalone" or "platform" (the identity home of a cloud, with
	// Regions set).
	Mode string `json:"mode"`
	// ConsoleProjectID is the one project the console signs into and
	// manages: the resolved default in standalone (Console ADR 0004 §2),
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
	// Regions are the regions of the cloud in platform mode, in the order
	// configured; absent in standalone.
	Regions []consoleRegion `json:"regions,omitempty"`
}

// runtimeResolver produces the current runtime document. Resolved per
// request: the default project changes when `zitadel setup` creates the
// deployment's first project, without a server restart.
type runtimeResolver func(ctx context.Context) (consoleRuntime, error)

// newRuntimeResolver resolves the runtime document from the deployment's
// default project (configured pin or first-created), including the project's
// publishable key derived from its token encryption key. With regions the
// document is the platform one: the same sign-in project, plus the regions.
func newRuntimeResolver(
	projects service.ProjectService,
	tokens service.TokenService,
	keys service.KeyService,
	cfgProjectID string,
	regions []RegionConfig,
) runtimeResolver {
	mode := ConsoleModeStandalone
	var published []consoleRegion
	if len(regions) > 0 {
		mode = ConsoleModePlatform
		for _, region := range regions {
			published = append(published, consoleRegion{ID: region.ID, Name: region.Name, APIBase: region.APIBase})
		}
	}
	return func(ctx context.Context) (consoleRuntime, error) {
		project, err := projects.DefaultProject(ctx, cfgProjectID)
		if err != nil {
			return consoleRuntime{}, err
		}
		meta := consoleRuntime{Mode: mode, Regions: published}
		if project == nil {
			return meta, nil
		}
		meta.ConsoleProjectID = project.ID

		key, err := publishableKey(ctx, tokens, keys, project)
		if err != nil {
			return consoleRuntime{}, err
		}
		meta.PublishableKey = key
		return meta, nil
	}
}

func publishableKey(
	ctx context.Context,
	tokens service.TokenService,
	keys service.KeyService,
	project *domain.Project,
) (string, error) {
	previewToken, err := tokens.GetActivePreviewToken(ctx, project.ID)
	if err != nil {
		// No record yet (or none that still grants anything): mint one. Any
		// other failure is a real one and must not silently issue a key.
		if !errors.Is(err, domain.TokenNotFound()) {
			return "", err
		}
		return tokens.GenerateJWE(ctx, project.PreviewToken())
	}

	tokenCrypter, err := keys.GetProjectCrypter(ctx, project.ID, domain.EncryptionKeyPurposeToken)
	if err != nil {
		return "", err
	}
	return previewToken.JWE(tokenCrypter)
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
