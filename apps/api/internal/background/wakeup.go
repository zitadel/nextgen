package background

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/errlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// WakeUpPath is where a scheduler outside the process wakes the server: each
// call that carries server.wake_up.secret runs every periodic task once. It
// is the deployment operator's, outside the API: no client calls it.
const WakeUpPath = "/cron/wake-up"

// minWakeUpSecretLength is the length Vercel recommends for CRON_SECRET.
const minWakeUpSecretLength = 16

// wakeUpTimeout bounds the rounds one call runs. It stays under the five
// minutes a Vercel function runs by default, so the scheduler learns how the
// call ended.
const wakeUpTimeout = 4*time.Minute + 30*time.Second

// WakeUpConfig is server.wake_up.
type WakeUpConfig struct {
	// Secret opens the wake-up endpoint: a request to WakeUpPath that
	// carries it as a bearer token runs every periodic task once. Empty, the
	// default, the server has no such endpoint and its periodic work runs on
	// its own timers only.
	Secret string `mapstructure:"secret"`
}

// Validate refuses a secret that is short enough to guess or that a request
// header cannot carry as it is.
func (c WakeUpConfig) Validate() error {
	if c.Secret == "" {
		return nil
	}
	if err := CheckWakeUpSecret(c.Secret); err != nil {
		return fmt.Errorf("server.wake_up.secret %w", err)
	}
	return nil
}

// CheckWakeUpSecret is Validate's rule for a secret on its own, for a caller
// that reads the secret from somewhere else. The error reads after the
// setting's name.
func CheckWakeUpSecret(secret string) error {
	invisible := func(r rune) bool { return r < '!' || r > '~' }
	if len(secret) < minWakeUpSecretLength || strings.IndexFunc(secret, invisible) >= 0 {
		return fmt.Errorf("must be at least %d printable ASCII characters, without spaces", minWakeUpSecretLength)
	}
	return nil
}

// wakeUpAnswer is what a call is answered with: each periodic task and
// whether its round succeeded. Why one failed stays in the server's log.
type wakeUpAnswer struct {
	Tasks []wakeUpTask `json:"tasks"`
}

type wakeUpTask struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
}

// WakeUp is the wake-up endpoint's handler: each GET or POST that carries the
// secret as a bearer token runs one round of every periodic task that
// started, one after the other, and answers which succeeded, with 500 when
// one did not. It is nil without a secret. Call it once the tasks have
// started.
func (g *Group) WakeUp() http.Handler {
	if g.wakeUp.Secret == "" {
		return nil
	}
	// Hashes, so the comparison takes as long whatever the length of the
	// token a request sends.
	secret := sha256.Sum256([]byte(g.wakeUp.Secret))
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

		// The rounds may outlast the server's write timeout, which every
		// other request keeps: past it, the scheduler would never hear how
		// the call ended.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(wakeUpTimeout + 10*time.Second))

		ctx, cancel := context.WithTimeout(r.Context(), wakeUpTimeout)
		defer cancel()
		answer, err := g.runPeriodic(ctx)
		status := http.StatusOK
		if err != nil {
			// The request's context, not the rounds': a round that ran out
			// of time is an Error, a client that left a Warn.
			errlog.LogFault(r.Context(), err)
			status = http.StatusInternalServerError
		}
		// Logged when every round succeeded too: every call leaves a line.
		zlog.Info(r.Context(), "wake-up: ran the periodic tasks", slog.Int("tasks", len(answer.Tasks)), slog.Bool("ok", err == nil))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(answer)
	})
}

// runPeriodic runs one round of every periodic task, one after the other in
// the order they started, each under what is left of ctx. A failed round
// does not keep the next from running; the error names every task that
// failed.
func (g *Group) runPeriodic(ctx context.Context) (wakeUpAnswer, error) {
	answer := wakeUpAnswer{Tasks: make([]wakeUpTask, 0, len(g.periodic))}
	var failed []error
	for _, task := range g.periodic {
		err := task.once(ctx)
		if err != nil {
			failed = append(failed, fmt.Errorf("%s: %w", task.name, err))
		}
		answer.Tasks = append(answer.Tasks, wakeUpTask{Name: strings.ReplaceAll(task.name, " ", "_"), OK: err == nil})
	}
	return answer, errors.Join(failed...)
}
