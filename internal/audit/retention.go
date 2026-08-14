package audit

import (
	"context"
	"log/slog"
	"sync"
	"time"
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

// RetentionJob periodically deletes events older than the retention window.
type RetentionJob struct {
	cfg       RetentionConfig
	purge     EventPurger
	stop      chan struct{}
	done      chan struct{}
	runMu     sync.Mutex
	runCancel context.CancelFunc
}

func NewRetentionJob(purge EventPurger, cfg RetentionConfig) *RetentionJob {
	return &RetentionJob{
		cfg:   applyRetentionDefaults(cfg),
		purge: purge,
		stop:  make(chan struct{}),
		done:  make(chan struct{}),
	}
}

func (j *RetentionJob) Start() {
	if !j.cfg.Enabled {
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	j.runMu.Lock()
	j.runCancel = cancel
	j.runMu.Unlock()
	defer func() {
		cancel()
		j.runMu.Lock()
		j.runCancel = nil
		j.runMu.Unlock()
	}()

	cutoff := time.Now().UTC().Add(-j.cfg.Retention)
	n, err := j.purge.DeleteEventsOlderThan(ctx, cutoff)
	if err != nil {
		slog.Error("event retention: purge failed", slog.String("error", err.Error()))
		return
	}
	if n > 0 {
		slog.Info("event retention: purged events", slog.Int64("deleted", n))
	}
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
