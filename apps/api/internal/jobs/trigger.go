package jobs

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/errlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// TriggerPath is where a scheduler drains due jobs when jobs.trigger_secret
// is set. Operator path, outside the API — same shape as
// audit.RetentionTriggerPath.
const TriggerPath = "/cron/jobs"

// triggerTimeout bounds a Cron drain. Mirrors retentionTriggerTimeout so the
// scheduler learns how the run ended under Vercel's default five-minute cap.
const triggerTimeout = 4*time.Minute + 30*time.Second

// Validate refuses a trigger secret that is short enough to guess or that a
// request header cannot carry as it is.
func (c Config) Validate() error {
	if c.TriggerSecret == "" {
		return nil
	}
	if err := audit.CheckTriggerSecret(c.TriggerSecret); err != nil {
		return fmt.Errorf("jobs.trigger_secret %w", err)
	}
	return nil
}

// Trigger is the handler that drains due work once per GET or POST that
// carries the trigger secret as a bearer token. It is nil unless the config
// names a trigger secret. Drain loops RunDueOnce until Take returns nothing
// runnable or the request deadline fires.
func (e *Engine) Trigger() http.Handler {
	if e.cfg.TriggerSecret == "" {
		return nil
	}
	secret := sha256.Sum256([]byte(e.cfg.TriggerSecret))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, POST")
			errlog.Log(r.Context(), domain.ErrRequestMethodNotAllowed())
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
		sent := sha256.Sum256([]byte(token))
		if !strings.EqualFold(scheme, "Bearer") || subtle.ConstantTimeCompare(sent[:], secret[:]) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			errlog.Log(r.Context(), domain.ErrAuthUnauthorized(nil))
			http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
			return
		}

		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(triggerTimeout + 10*time.Second))

		ctx, cancel := context.WithTimeout(r.Context(), triggerTimeout)
		defer cancel()

		ran, err := e.drain(ctx)
		if err != nil && !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
			errlog.LogFault(r.Context(), err)
			http.Error(w, "jobs: drain failed", http.StatusInternalServerError)
			return
		}
		zlog.Info(ctx, "jobs: drained due work", slog.Int("ran", ran))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = fmt.Fprintf(w, "{\"ran\":%d}\n", ran)
	})
}

// drain RunsDueOnce until empty or ctx ends. A deadline mid-batch is not a
// hard error — remaining work waits for the next Cron tick.
func (e *Engine) drain(ctx context.Context) (int, error) {
	total := 0
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := e.RunDueOnce(ctx, e.cfg.TakeBatchSize)
		total += n
		if err != nil {
			return total, err
		}
		if n == 0 {
			return total, nil
		}
	}
}
