package harness

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

// Affinity decides which sessions a VU shares. The two choices measure
// different things, so a scenario states which it wants rather than getting
// one by accident.
type Affinity string

const (
	// AffinityShared: every VU uses the same session, as many clients behind
	// one login would.
	AffinityShared Affinity = "shared"
	// AffinityVU: each VU holds a session of its own, as that many separate
	// logins would.
	AffinityVU Affinity = "vu"
)

// Session is one authenticated session and the token that manages it.
type Session struct {
	Token     string
	ID        string
	ExpiresAt time.Time
}

// SessionLogin establishes a new session: the login journey and the handoff
// exchange. It is the expensive step the cache exists to keep off the
// measured path.
type SessionLogin func(ctx context.Context) (Session, error)

// SessionCacheConfig configures a SessionCache.
type SessionCacheConfig struct {
	// Capacity is the most sessions the cache holds; asking for a slot beyond
	// it is an error rather than an eviction, because an eviction would put a
	// login back on the measured path. Default 1024.
	Capacity int
	// Margin is how long before expiry a session is refreshed. It must be
	// shorter than the session's lifetime. Default 60s.
	Margin time.Duration
	// Interval is how often the background path looks for sessions inside the
	// margin. Default a tenth of Margin, between 50ms and 5s.
	Interval time.Duration
	// RetryBackoff is how long a slot waits after a failed refresh before the
	// background path tries it again. Default 1s.
	RetryBackoff time.Duration
	Affinity     Affinity
}

func (c SessionCacheConfig) withDefaults() SessionCacheConfig {
	if c.Capacity <= 0 {
		c.Capacity = 1024
	}
	if c.Margin <= 0 {
		c.Margin = time.Minute
	}
	if c.Interval <= 0 {
		c.Interval = min(max(c.Margin/10, 50*time.Millisecond), 5*time.Second)
	}
	if c.RetryBackoff <= 0 {
		c.RetryBackoff = time.Second
	}
	if c.Affinity == "" {
		c.Affinity = AffinityShared
	}
	return c
}

// RefreshRecord is the cost of one login the cache paid. The cache keeps them
// out of the request path and out of every operation trend: the module drains
// them onto the nextgen_session_refresh_duration metric, where they are
// visible and auditable on their own.
type RefreshRecord struct {
	At       time.Time
	Duration time.Duration
	OK       bool
	// MeasuredPath is true when a caller waited for this login, which is a
	// cache miss, and false for the background refresh the cache schedules.
	MeasuredPath bool
}

// SessionCache is a process-wide, concurrency-safe set of sessions that are
// re-established before they expire. It lives on the root module, once per k6
// process, and every VU reads from it.
//
// Sessions are refreshed against Margin on a background path. A Get that
// finds no usable session is a miss: it pays for a login inside the caller's
// iteration, and the cache counts it, because that is a login in a measured
// iteration and the window it happened in is not valid.
type SessionCache struct {
	cfg   SessionCacheConfig
	login SessionLogin
	now   func() time.Time

	mu       sync.RWMutex
	entries  map[int]Session
	inflight map[int]*refreshCall
	retryAt  map[int]time.Time

	recMu   sync.Mutex
	records []RefreshRecord

	misses atomic.Int64

	startOnce sync.Once
	cancel    context.CancelFunc
	done      chan struct{}
}

// refreshCall is one login in flight, shared by everyone who wants the same
// slot while it runs.
type refreshCall struct {
	done chan struct{}
	sess Session
	err  error
}

// NewSessionCache returns a cache that establishes sessions with login.
func NewSessionCache(cfg SessionCacheConfig, login SessionLogin) *SessionCache {
	return &SessionCache{
		cfg:      cfg.withDefaults(),
		login:    login,
		now:      time.Now,
		entries:  map[int]Session{},
		inflight: map[int]*refreshCall{},
		retryAt:  map[int]time.Time{},
		done:     make(chan struct{}),
	}
}

// Config returns the effective configuration, defaults applied.
func (c *SessionCache) Config() SessionCacheConfig { return c.cfg }

// Slot maps a VU id (1-based, as k6 numbers them) to the slot it uses.
func (c *SessionCache) Slot(vuID int) int {
	if c.cfg.Affinity == AffinityVU {
		return max(vuID-1, 0)
	}
	return 0
}

// SlotsFor is how many slots a run of vus VUs needs.
func (c *SessionCache) SlotsFor(vus int) int {
	if c.cfg.Affinity == AffinityVU {
		return max(vus, 1)
	}
	return 1
}

// Warm establishes the first slots sessions before anything is measured and
// starts the background refresh. A session whose lifetime is not longer than
// the refresh margin would be refreshed continuously, which is a
// misconfiguration worth refusing at once.
func (c *SessionCache) Warm(ctx context.Context, slots int) error {
	if slots > c.cfg.Capacity {
		return fmt.Errorf("%d sessions wanted but the cache holds %d: raise the capacity or use shared affinity", slots, c.cfg.Capacity)
	}
	err := forEach(ctx, slots, func(ctx context.Context, slot int) error {
		s, err := c.refresh(ctx, slot, false)
		if err != nil {
			return fmt.Errorf("session %d: %w", slot, err)
		}
		if life := s.ExpiresAt.Sub(c.now()); life <= c.cfg.Margin {
			return fmt.Errorf("session %d lives %s, not longer than the refresh margin %s: it would refresh continuously", slot, life.Round(time.Millisecond), c.cfg.Margin)
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.start()
	return nil
}

// Get returns the session for slot. miss reports that no usable session was
// held and the caller paid for a login.
func (c *SessionCache) Get(ctx context.Context, slot int) (s Session, miss bool, err error) {
	if slot < 0 || slot >= c.cfg.Capacity {
		return Session{}, false, fmt.Errorf("session slot %d is outside the capacity %d", slot, c.cfg.Capacity)
	}
	c.mu.RLock()
	s, ok := c.entries[slot]
	c.mu.RUnlock()
	if ok && s.ExpiresAt.After(c.now()) {
		return s, false, nil
	}
	c.misses.Add(1)
	s, err = c.refresh(ctx, slot, true)
	return s, true, err
}

// Misses is how many Gets found no usable session.
func (c *SessionCache) Misses() int64 { return c.misses.Load() }

// DrainRecords returns the refresh costs recorded since the last call.
func (c *SessionCache) DrainRecords() []RefreshRecord {
	c.recMu.Lock()
	defer c.recMu.Unlock()
	out := c.records
	c.records = nil
	return out
}

// Close stops the background refresh and waits for it.
func (c *SessionCache) Close() {
	if c.cancel != nil {
		c.cancel()
		<-c.done
	}
}

// refresh establishes a session for slot. Concurrent callers for the same
// slot share one login, whether the first of them is the background path or a
// miss, so one credential never produces two login journeys at once.
func (c *SessionCache) refresh(ctx context.Context, slot int, measured bool) (Session, error) {
	if slot < 0 || slot >= c.cfg.Capacity {
		return Session{}, fmt.Errorf("session slot %d is outside the capacity %d", slot, c.cfg.Capacity)
	}
	c.mu.Lock()
	if call, ok := c.inflight[slot]; ok {
		c.mu.Unlock()
		select {
		case <-call.done:
			return call.sess, call.err
		case <-ctx.Done():
			return Session{}, ctx.Err()
		}
	}
	call := &refreshCall{done: make(chan struct{})}
	c.inflight[slot] = call
	c.mu.Unlock()

	// The login serves everyone waiting on it, so it must not die with the
	// first caller's context.
	loginCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
	defer cancel()
	start := c.now()
	sess, err := c.login(loginCtx)
	took := c.now().Sub(start)

	c.recMu.Lock()
	c.records = append(c.records, RefreshRecord{At: start, Duration: took, OK: err == nil, MeasuredPath: measured})
	c.recMu.Unlock()

	c.mu.Lock()
	if err == nil {
		c.entries[slot] = sess
		delete(c.retryAt, slot)
	} else {
		c.retryAt[slot] = c.now().Add(c.cfg.RetryBackoff)
	}
	delete(c.inflight, slot)
	c.mu.Unlock()

	call.sess, call.err = sess, err
	close(call.done)
	return sess, err
}

func (c *SessionCache) start() {
	c.startOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		c.cancel = cancel
		go c.run(ctx)
	})
}

// run is the background path: it looks for sessions inside the margin and
// re-establishes them, so no measured operation has to.
func (c *SessionCache) run(ctx context.Context) {
	defer close(c.done)
	tick := time.NewTicker(c.cfg.Interval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		due := c.dueSlots()
		// A failure leaves the old session in place until it expires and is
		// retried after the backoff; the error is on the record.
		_ = forEach(ctx, len(due), func(ctx context.Context, i int) error {
			_, _ = c.refresh(ctx, due[i], false)
			return nil
		})
	}
}

func (c *SessionCache) dueSlots() []int {
	now := c.now()
	c.mu.RLock()
	defer c.mu.RUnlock()
	var due []int
	for slot, s := range c.entries {
		if _, running := c.inflight[slot]; running {
			continue
		}
		if t, backoff := c.retryAt[slot]; backoff && now.Before(t) {
			continue
		}
		if s.ExpiresAt.Sub(now) <= c.cfg.Margin {
			due = append(due, slot)
		}
	}
	slices.Sort(due)
	return due
}

// ErrNoSessions is returned when a scenario asks for a session and the run
// configured none.
var ErrNoSessions = errors.New("session cache is not configured")
