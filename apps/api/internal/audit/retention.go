package audit

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/background"
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

// RetentionJob deletes events older than the retention window: on its own
// timer, and once per call to the server's wake-up endpoint.
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

// Task is the purge as background work. Where instances come and go it purges
// as each one starts and on its timer while one is up. A process paused
// between requests runs no timer, so there it purges only when the server is
// woken.
func (j *RetentionJob) Task() background.Task {
	return background.Task{
		Name:        "event retention",
		Disabled:    !j.cfg.Enabled,
		Start:       func(context.Context) error { j.Start(); return nil },
		Stop:        j.Close,
		Once:        j.Once,
		ScaleToZero: background.WhileUp(),
		RequestOnly: background.OnWakeUp("turn the purge off with events.retention.enabled"),
	}
}

// Start starts the loop, unless retention is off.
func (j *RetentionJob) Start() {
	if !j.cfg.Enabled {
		close(j.done)
		return
	}
	go j.loop() //background:allow the task "event retention"
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

// Once runs one purge for a caller that waits for it, such as a call to the
// wake-up endpoint, and logs how many events it deleted. ctx gives the purge
// its deadline.
func (j *RetentionJob) Once(ctx context.Context) error {
	ctx, span := startJobSpan(ctx, "audit.PurgeExpiredEvents")
	defer span.End()

	n, err := j.deleteExpired(ctx)
	if err != nil {
		failJobSpan(ctx, err)
		return err
	}
	// Logged when nothing was deleted too: every run leaves a line.
	zlog.Info(ctx, "event retention: purged events", slog.Int64("deleted", n))
	return nil
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
