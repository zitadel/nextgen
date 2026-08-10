package audit

import (
	"context"
	"log/slog"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// ProjectLister lists project IDs for retention sweeps.
type ProjectLister interface {
	ListProjectIDs(ctx context.Context) ([]string, error)
}

// EventPurger deletes old events.
type EventPurger interface {
	DeleteEventsOlderThan(ctx context.Context, projectID string, createdBefore time.Time) (int64, error)
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
	cfg    RetentionConfig
	list   ProjectLister
	purge  EventPurger
	stop   chan struct{}
	done   chan struct{}
	purged uint64
}

func NewRetentionJob(list ProjectLister, purge EventPurger, cfg RetentionConfig) *RetentionJob {
	if cfg.Retention <= 0 {
		cfg.Retention = 30 * 24 * time.Hour
	}
	if cfg.Interval <= 0 {
		cfg.Interval = time.Hour
	}
	return &RetentionJob{
		cfg:   cfg,
		list:  list,
		purge: purge,
		stop:  make(chan struct{}),
		done:  make(chan struct{}),
	}
}

// Start runs the job in the background.
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
	ids, err := j.list.ListProjectIDs(ctx)
	if err != nil {
		slog.Error("event retention: list projects failed", slog.String("error", err.Error()))
		return
	}
	cutoff := time.Now().UTC().Add(-j.cfg.Retention)
	var total int64
	for _, id := range ids {
		n, err := j.purge.DeleteEventsOlderThan(ctx, id, cutoff)
		if err != nil {
			slog.Error("event retention: purge failed",
				slog.String("project_id", id),
				slog.String("error", err.Error()),
			)
			continue
		}
		total += n
	}
	if total > 0 {
		slog.Info("event retention: purged events", slog.Int64("deleted", total))
	}
}

// Close stops the job.
func (j *RetentionJob) Close() {
	select {
	case <-j.stop:
	default:
		close(j.stop)
	}
	<-j.done
}

// Ensure domain.Event is referenced for goimports if needed.
var _ = domain.EventTypeRequestAPI
