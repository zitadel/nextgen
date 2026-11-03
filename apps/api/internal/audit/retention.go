package audit

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// EventPurger deletes old events across all projects (including orphaned
// project_id values after hard-delete).
type EventPurger interface {
	DeleteEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error)
}

// RetentionConfig controls time-only event purge (ADR 049).
type RetentionConfig struct {
	Retention time.Duration `mapstructure:"window"`
	Interval  time.Duration `mapstructure:"interval"`
	Enabled   bool          `mapstructure:"enabled"`
	// TriggerSecret hands the schedule to something outside the process.
	// Set, the server runs no loop of its own and purges once per request to
	// RetentionTriggerPath that carries it as a bearer token: a server that
	// runs only while it serves a request, such as a Vercel function, cannot
	// keep a loop going.
	TriggerSecret string `mapstructure:"trigger_secret"`
}

// RetentionTriggerPath is where a scheduler starts one purge when the
// config names a trigger secret. It is the deployment operator's, outside
// the API: no client calls it.
const RetentionTriggerPath = "/cron/events-retention"

// minTriggerSecretLength is the length Vercel recommends for CRON_SECRET.
const minTriggerSecretLength = 16

// Validate refuses a trigger secret that is short enough to guess or that a
// request header cannot carry as it is.
func (c RetentionConfig) Validate() error {
	if c.TriggerSecret == "" {
		return nil
	}
	if err := CheckTriggerSecret(c.TriggerSecret); err != nil {
		return fmt.Errorf("events.retention.trigger_secret %w", err)
	}
	return nil
}

// CheckTriggerSecret is Validate's rule for a secret on its own, for a
// caller that reads the secret from somewhere else. The error reads after
// the setting's name.
func CheckTriggerSecret(secret string) error {
	invisible := func(r rune) bool { return r < '!' || r > '~' }
	if len(secret) < minTriggerSecretLength || strings.IndexFunc(secret, invisible) >= 0 {
		return fmt.Errorf("must be at least %d printable ASCII characters, without spaces", minTriggerSecretLength)
	}
	return nil
}

func DefaultRetentionConfig() RetentionConfig {
	return RetentionConfig{
		Retention: 30 * 24 * time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	}
}

func applyRetentionDefaults(cfg RetentionConfig) RetentionConfig {
	def := DefaultRetentionConfig()
	if cfg.Retention <= 0 {
		cfg.Retention = def.Retention
	}
	if cfg.Interval <= 0 {
		cfg.Interval = def.Interval
	}
	return cfg
}

const retentionCloseTimeout = 5 * time.Second

// retentionTriggerTimeout bounds a purge that a request starts. It stays
// under the five minutes a Vercel function runs by default, so the
// scheduler learns how the run ended.
const retentionTriggerTimeout = 4*time.Minute + 30*time.Second

// RetentionJob deletes events older than the retention window: on its own
// timer, or once per request to its trigger when the config names a
// trigger secret.
type RetentionJob struct {
	cfg       RetentionConfig
	purge     EventPurger
	stop      chan struct{}
	done      chan struct{}
	runMu     sync.Mutex
	runCancel context.CancelFunc
	// purging holds a token while a purge runs, so the purges of one
	// process run one after the other.
	purging chan struct{}
}

func NewRetentionJob(purge EventPurger, cfg RetentionConfig) *RetentionJob {
	return &RetentionJob{
		cfg:     applyRetentionDefaults(cfg),
		purge:   purge,
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
		purging: make(chan struct{}, 1),
	}
}

// Start starts the loop, unless retention is off or a trigger runs it.
func (j *RetentionJob) Start() {
	if !j.cfg.Enabled || j.cfg.TriggerSecret != "" {
		close(j.done)
		return
	}
	go j.loop()
}

func (j *RetentionJob) loop() {
	defer close(j.done)
	ticker := time.NewTicker(j.cfg.Interval)
	defer ticker.Stop()
	j.runOnce()
	for {
		select {
		case <-j.stop:
			return
		case <-ticker.C:
			j.runOnce()
		}
	}
}

func (j *RetentionJob) runOnce() {
	ctx, span := startJobSpan(context.Background(), "audit.PurgeExpiredEvents")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	j.runMu.Lock()
	j.runCancel = cancel
	j.runMu.Unlock()
	defer func() {
		cancel()
		j.runMu.Lock()
		j.runCancel = nil
		j.runMu.Unlock()
	}()

	n, err := j.deleteExpired(ctx)
	if err != nil {
		failJobSpan(ctx, err)
		slog.Error("event retention: purge failed", slog.String("error", err.Error()))
		return
	}
	if n > 0 {
		slog.Info("event retention: purged events", slog.Int64("deleted", n))
	}
}

// deleteExpired deletes the events older than the window. A purge waits for
// the one this process is running; one that another process runs at the
// same time deletes what the other leaves, or nothing.
func (j *RetentionJob) deleteExpired(ctx context.Context) (int64, error) {
	select {
	case j.purging <- struct{}{}:
	case <-ctx.Done():
		return 0, ctx.Err()
	}
	defer func() { <-j.purging }()
	return j.purge.DeleteEventsOlderThan(ctx, time.Now().UTC().Add(-j.cfg.Retention))
}

// Trigger is the handler that purges once per GET or POST that carries the
// trigger secret as a bearer token, and answers how many events it deleted.
// It is nil unless retention is on and the config names a trigger secret.
func (j *RetentionJob) Trigger() http.Handler {
	if !j.cfg.Enabled || j.cfg.TriggerSecret == "" {
		return nil
	}
	// Hashes, so the comparison takes as long whatever the length of the
	// token a request sends.
	secret := sha256.Sum256([]byte(j.cfg.TriggerSecret))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, POST")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
		sent := sha256.Sum256([]byte(token))
		if !strings.EqualFold(scheme, "Bearer") || subtle.ConstantTimeCompare(sent[:], secret[:]) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
			return
		}

		// A run may outlast the server's write timeout, which every other
		// request keeps: past it, the scheduler would never hear how the run
		// ended.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(retentionTriggerTimeout + 10*time.Second))

		ctx, cancel := context.WithTimeout(r.Context(), retentionTriggerTimeout)
		defer cancel()
		ctx, span := startJobSpan(ctx, "audit.PurgeExpiredEvents")
		defer span.End()

		n, err := j.deleteExpired(ctx)
		if err != nil {
			failJobSpan(ctx, err)
			zlog.Error(ctx, "event retention: purge failed", slog.String("error", err.Error()))
			http.Error(w, "event retention: purge failed", http.StatusInternalServerError)
			return
		}
		// Logged when nothing was deleted too: every run leaves a line.
		zlog.Info(ctx, "event retention: purged events", slog.Int64("deleted", n))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = fmt.Fprintf(w, "{\"deleted\":%d}\n", n)
	})
}

func (j *RetentionJob) Close() {
	select {
	case <-j.stop:
	default:
		close(j.stop)
	}
	j.runMu.Lock()
	if j.runCancel != nil {
		j.runCancel()
	}
	j.runMu.Unlock()
	select {
	case <-j.done:
	case <-time.After(retentionCloseTimeout):
		slog.Warn("event retention: shutdown timed out")
	}
}
