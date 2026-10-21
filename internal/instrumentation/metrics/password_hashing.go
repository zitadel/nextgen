package metrics

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/metric"
)

// Password hashing is the one piece of request work whose cost is set by
// configuration rather than by the request, so the server admits only so much
// of it at once. These series say how close that admission control is to its
// limit: what holds a slot, what is queued for one, and what was turned away.
// The queue is the signal an autoscaler wants, since a hash that waits is a
// hash that would have run had there been another replica; the rejections are
// what the operator sees as 429s and should be the exception.
//
// Changing one of these names is a breaking change for whatever is graphing it.
const (
	PasswordHashingInFlight       = "zitadel.password_hashing.in_flight"
	PasswordHashingWaiting        = "zitadel.password_hashing.waiting"
	PasswordHashingMemoryReserved = "zitadel.password_hashing.memory_reserved"
	PasswordHashingRejected       = "zitadel.password_hashing.rejected"
	PasswordHashingWaitDuration   = "zitadel.password_hashing.wait_duration"
)

// PasswordHashingState is what the limiter knows about itself, read when the
// collector asks. Observable gauges fit here for the same reason they fit a
// cache's size: the limiter already keeps these counts to do its job.
type PasswordHashingState struct {
	InFlight       func() int64
	Waiting        func() int64
	MemoryReserved func() int64
}

// PasswordHashing is the limiter's instruments. The zero value is not usable;
// build it with NewPasswordHashing. One built with no meter provider is safe to
// call and records nothing.
type PasswordHashing struct {
	rejected metric.Int64Counter
	wait     metric.Float64Histogram
}

// NewPasswordHashing builds the instruments for the password hashing limiter.
func NewPasswordHashing(state PasswordHashingState, opts ...Option) (*PasswordHashing, error) {
	m := meter(opts)

	rejected, err := m.Int64Counter(PasswordHashingRejected,
		metric.WithDescription("Password hashes refused because no slot freed up within the configured wait."))
	if err != nil {
		return nil, err
	}
	wait, err := m.Float64Histogram(PasswordHashingWaitDuration,
		metric.WithDescription("Time a password hash waited for a slot before it ran."),
		metric.WithUnit("s"))
	if err != nil {
		return nil, err
	}

	inFlight, err := m.Int64ObservableGauge(PasswordHashingInFlight,
		metric.WithDescription("Password hashes currently running."))
	if err != nil {
		return nil, err
	}
	waiting, err := m.Int64ObservableGauge(PasswordHashingWaiting,
		metric.WithDescription("Password hashes waiting for a slot."))
	if err != nil {
		return nil, err
	}
	reserved, err := m.Int64ObservableGauge(PasswordHashingMemoryReserved,
		metric.WithDescription("Memory the running password hashes are budgeted to use."),
		metric.WithUnit("By"))
	if err != nil {
		return nil, err
	}
	if _, err := m.RegisterCallback(
		func(_ context.Context, observer metric.Observer) error {
			observer.ObserveInt64(inFlight, state.InFlight())
			observer.ObserveInt64(waiting, state.Waiting())
			observer.ObserveInt64(reserved, state.MemoryReserved())
			return nil
		},
		inFlight, waiting, reserved,
	); err != nil {
		return nil, err
	}

	return &PasswordHashing{rejected: rejected, wait: wait}, nil
}

// RecordWait records how long a hash waited for its slot, whether or not it
// got one.
func (p *PasswordHashing) RecordWait(d time.Duration) {
	p.wait.Record(context.Background(), d.Seconds())
}

// RecordRejected counts a hash the limiter turned away.
func (p *PasswordHashing) RecordRejected() {
	p.rejected.Add(context.Background(), 1)
}
