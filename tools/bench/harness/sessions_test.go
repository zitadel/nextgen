package harness

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeClock is a manually advanced clock for the cache.
type fakeClock struct{ ns atomic.Int64 }

func newFakeClock() *fakeClock {
	c := &fakeClock{}
	c.ns.Store(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).UnixNano())
	return c
}
func (c *fakeClock) Now() time.Time          { return time.Unix(0, c.ns.Load()).UTC() }
func (c *fakeClock) Advance(d time.Duration) { c.ns.Add(int64(d)) }

// countingLogin issues sessions living ttl on the clock and counts the logins.
type countingLogin struct {
	clock *fakeClock
	ttl   time.Duration
	calls atomic.Int64
	delay time.Duration
	fail  atomic.Bool
}

func (l *countingLogin) login(ctx context.Context) (Session, error) {
	n := l.calls.Add(1)
	if l.delay > 0 {
		time.Sleep(l.delay)
	}
	if l.fail.Load() {
		return Session{}, errors.New("login refused")
	}
	return Session{Token: fmt.Sprintf("tok-%d", n), ID: fmt.Sprintf("sess-%d", n), ExpiresAt: l.clock.Now().Add(l.ttl)}, nil
}

func (c *SessionCache) inflightCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.inflight)
}

func newTestCache(t *testing.T, l *countingLogin, cfg SessionCacheConfig) *SessionCache {
	t.Helper()
	c := NewSessionCache(cfg, l.login)
	c.now = l.clock.Now
	t.Cleanup(c.Close)
	return c
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// TestConcurrentRefreshDoesNotDuplicateLogins: the acceptance criterion. Many
// callers wanting the same credential at once share one login journey.
func TestConcurrentRefreshDoesNotDuplicateLogins(t *testing.T) {
	l := &countingLogin{clock: newFakeClock(), ttl: time.Hour, delay: 50 * time.Millisecond}
	c := newTestCache(t, l, SessionCacheConfig{})

	const callers = 50
	var wg sync.WaitGroup
	tokens := make([]string, callers)
	for i := range callers {
		wg.Go(func() {
			s, miss, err := c.Get(t.Context(), 0)
			if err != nil || !miss {
				t.Errorf("caller %d: miss %t err %v", i, miss, err)
			}
			tokens[i] = s.Token
		})
	}
	wg.Wait()

	if got := l.calls.Load(); got != 1 {
		t.Errorf("%d concurrent callers produced %d login journeys, want 1", callers, got)
	}
	for _, tok := range tokens {
		if tok != tokens[0] {
			t.Fatalf("callers got different sessions: %q and %q", tokens[0], tok)
		}
	}
	if c.Misses() != callers {
		t.Errorf("misses = %d, want %d: each caller waited for a login", c.Misses(), callers)
	}
}

func TestWarmedSessionsAreHits(t *testing.T) {
	l := &countingLogin{clock: newFakeClock(), ttl: time.Hour}
	c := newTestCache(t, l, SessionCacheConfig{Margin: time.Minute, Affinity: AffinityVU})

	if err := c.Warm(t.Context(), c.SlotsFor(4)); err != nil {
		t.Fatal(err)
	}
	if l.calls.Load() != 4 {
		t.Fatalf("warm made %d logins for 4 VUs", l.calls.Load())
	}
	seen := map[string]bool{}
	for vu := 1; vu <= 4; vu++ {
		s, miss, err := c.Get(t.Context(), c.Slot(vu))
		if err != nil || miss {
			t.Fatalf("vu %d: miss %t err %v", vu, miss, err)
		}
		seen[s.Token] = true
	}
	if len(seen) != 4 {
		t.Errorf("per-VU affinity shared sessions: %v", seen)
	}
	if c.Misses() != 0 {
		t.Errorf("misses = %d", c.Misses())
	}
}

func TestSharedAffinityUsesOneSession(t *testing.T) {
	l := &countingLogin{clock: newFakeClock(), ttl: time.Hour}
	c := newTestCache(t, l, SessionCacheConfig{Margin: time.Minute})
	if c.SlotsFor(20) != 1 || c.Slot(1) != c.Slot(17) {
		t.Fatalf("shared affinity: %d slots, VU 1 -> %d, VU 17 -> %d", c.SlotsFor(20), c.Slot(1), c.Slot(17))
	}
	if err := c.Warm(t.Context(), c.SlotsFor(20)); err != nil {
		t.Fatal(err)
	}
	if l.calls.Load() != 1 {
		t.Errorf("shared warm made %d logins", l.calls.Load())
	}
}

// TestBackgroundRefreshRotatesBeforeExpiry: sessions are re-established inside
// the margin, so a reader that keeps reading while time passes never misses.
func TestBackgroundRefreshRotatesBeforeExpiry(t *testing.T) {
	clock := newFakeClock()
	l := &countingLogin{clock: clock, ttl: 10 * time.Minute}
	c := newTestCache(t, l, SessionCacheConfig{Margin: 2 * time.Minute, Interval: 2 * time.Millisecond})
	if err := c.Warm(t.Context(), 1); err != nil {
		t.Fatal(err)
	}

	// Walk through three session lifetimes in one-minute steps. At each step
	// the background path gets to act before the reader reads, as it does in
	// a real run where it wakes every Interval and a read comes much later.
	for range 30 {
		clock.Advance(time.Minute)
		eventually(t, "nothing left inside the margin", func() bool {
			return len(c.dueSlots()) == 0 && c.inflightCount() == 0
		})
		if s, miss, err := c.Get(t.Context(), 0); err != nil || miss || !s.ExpiresAt.After(clock.Now()) {
			t.Fatalf("at %s: miss %t err %v session %+v", clock.Now().Format(time.TimeOnly), miss, err, s)
		}
	}
	if c.Misses() != 0 {
		t.Errorf("a reader missed %d times although the background path was running", c.Misses())
	}
	if l.calls.Load() < 4 {
		t.Errorf("only %d logins in three session lifetimes", l.calls.Load())
	}
	recs := c.DrainRecords()
	for _, r := range recs {
		if r.MeasuredPath {
			t.Errorf("a background refresh was recorded as a measured-path login: %+v", r)
		}
	}
	if int64(len(recs)) != l.calls.Load() {
		t.Errorf("%d records for %d logins", len(recs), l.calls.Load())
	}
	if len(c.DrainRecords()) != 0 {
		t.Error("draining did not empty the records")
	}
}

// TestExpiredSessionIsAMiss: when nothing refreshed the session in time, the
// reader pays for the login and the cache counts it.
func TestExpiredSessionIsAMiss(t *testing.T) {
	clock := newFakeClock()
	l := &countingLogin{clock: clock, ttl: time.Minute}
	c := newTestCache(t, l, SessionCacheConfig{Margin: 10 * time.Second})
	// Not warmed through Warm, so no background path is running.
	if _, miss, err := c.Get(t.Context(), 0); err != nil || !miss {
		t.Fatalf("first Get: miss %t err %v", miss, err)
	}
	if _, miss, _ := c.Get(t.Context(), 0); miss {
		t.Fatal("a fresh session was a miss")
	}
	clock.Advance(2 * time.Minute)
	s, miss, err := c.Get(t.Context(), 0)
	if err != nil || !miss || !s.ExpiresAt.After(clock.Now()) {
		t.Fatalf("expired: miss %t err %v session %+v", miss, err, s)
	}
	if c.Misses() != 2 {
		t.Errorf("misses = %d, want 2", c.Misses())
	}
	var onPath int
	for _, r := range c.DrainRecords() {
		if r.MeasuredPath {
			onPath++
		}
	}
	if onPath != 2 {
		t.Errorf("%d logins recorded as measured-path, want 2", onPath)
	}
}

// TestFailedRefreshKeepsTheOldSession: a failing login must not discard a
// session that still works; the failure is on the record and retried later.
func TestFailedRefreshKeepsTheOldSession(t *testing.T) {
	clock := newFakeClock()
	l := &countingLogin{clock: clock, ttl: 10 * time.Minute}
	c := newTestCache(t, l, SessionCacheConfig{Margin: 2 * time.Minute, Interval: 2 * time.Millisecond, RetryBackoff: 5 * time.Millisecond})
	if err := c.Warm(t.Context(), 1); err != nil {
		t.Fatal(err)
	}
	old, _, _ := c.Get(t.Context(), 0)
	c.DrainRecords()

	l.fail.Store(true)
	clock.Advance(9 * time.Minute) // inside the margin, still valid
	eventually(t, "a failed refresh", func() bool {
		for _, r := range c.DrainRecords() {
			if !r.OK {
				return true
			}
		}
		return false
	})
	s, miss, err := c.Get(t.Context(), 0)
	if err != nil || miss || s.Token != old.Token {
		t.Errorf("after a failed refresh: miss %t err %v token %q (was %q)", miss, err, s.Token, old.Token)
	}

	// Once the login recovers, the next retry rotates the session.
	l.fail.Store(false)
	eventually(t, "recovery", func() bool {
		clock.Advance(10 * time.Millisecond) // the retry backoff runs on the cache's clock
		s, _, err := c.Get(t.Context(), 0)
		return err == nil && s.Token != old.Token
	})
}

func TestCapacityIsAnErrorNotAnEviction(t *testing.T) {
	l := &countingLogin{clock: newFakeClock(), ttl: time.Hour}
	c := newTestCache(t, l, SessionCacheConfig{Capacity: 3, Margin: time.Minute, Affinity: AffinityVU})
	if err := c.Warm(t.Context(), 4); err == nil {
		t.Error("warming 4 slots into a capacity of 3 succeeded")
	}
	if l.calls.Load() != 0 {
		t.Errorf("%d logins before refusing", l.calls.Load())
	}
	if _, _, err := c.Get(t.Context(), 3); err == nil {
		t.Error("Get beyond the capacity succeeded")
	}
	if _, _, err := c.Get(t.Context(), -1); err == nil {
		t.Error("Get of a negative slot succeeded")
	}
}

func TestWarmRefusesASessionShorterThanTheMargin(t *testing.T) {
	l := &countingLogin{clock: newFakeClock(), ttl: 30 * time.Second}
	c := newTestCache(t, l, SessionCacheConfig{Margin: time.Minute})
	if err := c.Warm(t.Context(), 1); err == nil {
		t.Error("a session living less than the margin was accepted: it would refresh continuously")
	}
}

func TestSessionSettingsRoundTrip(t *testing.T) {
	in := SessionSettings{Affinity: AffinityVU, Margin: 30 * time.Second, Capacity: 64, TTL: 5 * time.Minute}
	env := in.Env()
	out, err := SessionSettingsFromEnv(func(k string) (string, bool) { v, ok := env[k]; return v, ok })
	if err != nil || out != in {
		t.Errorf("round trip: %+v, %v", out, err)
	}
	if empty := (SessionSettings{}).Env(); len(empty) != 0 {
		t.Errorf("defaults rendered as %v", empty)
	}
	if err := (SessionSettings{Affinity: "everyone"}).Validate(); err == nil {
		t.Error("unknown affinity accepted")
	}
	if err := (SessionSettings{TTL: time.Minute, Margin: 2 * time.Minute}).Validate(); err == nil {
		t.Error("a ttl not longer than the margin was accepted")
	}
}

// TestMissesInvalidateTheWindow: a non-zero count is not absorbed into the
// numbers; the sweep metadata names the run.
func TestMissesInvalidateTheWindow(t *testing.T) {
	meta := SweepMeta{Runs: []RunMeta{
		{Scenario: "getMySession", VUs: 5, Sessions: &SessionStats{Refreshes: 3}},
		{Scenario: "getMySession", VUs: 20, Sessions: &SessionStats{Refreshes: 3, Misses: 2}},
		{Scenario: "getUser", VUs: 5},
	}}
	invalid := meta.Invalid()
	if len(invalid) != 1 {
		t.Fatalf("invalid = %v", invalid)
	}
	md := Markdown(meta, nil)
	for _, want := range []string{"Session cache", "INVALID", "valid"} {
		if !strings.Contains(md, want) {
			t.Errorf("summary lacks %q:\n%s", want, md)
		}
	}
}
