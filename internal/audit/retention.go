package audit

import (
	"context"
	"log/slog"
	"time"
)

// EventPurger deletes old events across all projects (including orphaned
// project_id values after hard-delete).
type EventPurger interface {
	DeleteEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error)
}

// RetentionConfig controls time-only event purge (ADR 049).
type RetentionConfig struct {
	Retention time.Duration // default 30 days
	Interval  time.Duration // how often to run
	Enabled   bool
}

func DefaultRetentionConfig() RetentionConfig {
	return RetentionConfig{
		Retention: 30 * 24 * time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	}
}

// RetentionJob periodically deletes events older than the retention window.
type RetentionJob struct {
	cfg   RetentionConfig
	purge EventPurger
	stop  chan struct{}
	done  chan struct{}
}

func NewRetentionJob(purge EventPurger, cfg RetentionConfig) *RetentionJob {
	if cfg.Retention <= 0 {
		cfg.Retention = 30 * 24 * time.Hour
	}
	if cfg.Interval <= 0 {
		cfg.Interval = time.Hour
	}
	return &RetentionJob{
		cfg:   cfg,
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
	defer cancel()
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
	<-j.done
}
