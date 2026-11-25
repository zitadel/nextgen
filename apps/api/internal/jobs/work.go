package jobs

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Work is one leased unit of work for Perform (queued job or periodic schedule).
// DeadOnTake results never become Work — the Engine skips Perform for those.
type Work struct {
	ID       string
	Name     string
	Payload  []byte
	Attempt  int
	Periodic bool
}

// Handler Performs one leased Work. Handlers must be idempotent (at-least-once).
type Handler func(ctx context.Context, work Work) error

func workFromTake(r domain.TakeResult) (Work, string, bool) {
	switch {
	case r.Job != nil:
		return Work{
			ID:       r.Job.ID,
			Name:     r.Job.Name,
			Payload:  r.Job.Payload,
			Attempt:  r.Job.Attempt,
			Periodic: false,
		}, r.LeaseToken, true
	case r.Schedule != nil:
		return Work{
			ID:       r.Schedule.ID,
			Name:     r.Schedule.Name,
			Attempt:  r.Schedule.Attempt,
			Periodic: true,
		}, r.LeaseToken, true
	default:
		return Work{}, "", false
	}
}

func takeName(r domain.TakeResult) string {
	if r.Job != nil {
		return r.Job.Name
	}
	if r.Schedule != nil {
		return r.Schedule.Name
	}
	return ""
}

func takeRunAt(r domain.TakeResult) (time.Time, bool) {
	if r.Job != nil {
		return r.Job.RunAt, true
	}
	if r.Schedule != nil {
		return r.Schedule.RunAt, true
	}
	return time.Time{}, false
}

func takeMaxAttempts(r domain.TakeResult) int {
	if r.Job != nil {
		return r.Job.MaxAttempts
	}
	return 0
}
