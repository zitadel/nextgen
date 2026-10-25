package api

import (
	"context"
	"log/slog"
	"strings"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// The probes answer two questions apart (ADR 079 §5): /livez whether to
// restart the process, /readyz whether to send it requests.

// readyTimeout bounds /readyz's round trip to the database: one that has not
// answered by then counts as down.
const readyTimeout = time.Second

// Pinger is a database as /readyz asks it: whether it answers. Every
// dialect's pool is one.
type Pinger interface {
	Ping(ctx context.Context) error
}

// WithReadinessCheck wires the database /readyz pings. A chainable setter
// like WithPolicyService, so NewHandler's call sites stay unchanged; without
// it /readyz answers 503, since nothing says the database answers.
func (h *Handler) WithReadinessCheck(database Pinger) *Handler {
	h.readiness = database
	return h
}

// GetLive checks nothing behind the process: a liveness probe that checked the
// database would restart every instance whenever the database blips.
func (h *Handler) GetLive(ctx context.Context) (api.GetLiveRes, error) {
	return &api.GetLiveOK{Data: strings.NewReader("ok")}, nil
}

// GetReady answers ok once the database answers a ping within readyTimeout:
// one round trip on the pool.
func (h *Handler) GetReady(ctx context.Context) (api.GetReadyRes, error) {
	if h.readiness == nil {
		return notReady(), nil
	}
	ctx, cancel := context.WithTimeout(ctx, readyTimeout)
	defer cancel()
	if err := h.readiness.Ping(ctx); err != nil {
		// The request log records the 503; this line says why.
		zlog.GetLoggingContext(ctx).Warn("not ready: the database did not answer", slog.Any("error", err))
		return notReady(), nil
	}
	return &api.GetReadyOK{Data: strings.NewReader("ok")}, nil
}

func notReady() *api.GetReadyServiceUnavailable {
	return &api.GetReadyServiceUnavailable{Data: strings.NewReader("fail")}
}
