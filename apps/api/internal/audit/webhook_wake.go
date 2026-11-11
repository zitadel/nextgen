package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// WebhookWakeConfig names the wake hook (ADR 089 §4): where a server that
// delivers only on its trigger, and so keeps no timer, says that a project
// has events to deliver, and when a failed delivery is due again. What
// answers there calls WebhookTriggerPath for that project, at once or at the
// time named. It is a hint: the events table and the webhooks' cursors
// decide what is sent, and a call that is lost is made up for by the next
// one or by a scheduled round over every project.
type WebhookWakeConfig struct {
	// URL takes a POST of a webhookWakeCall per wake-up.
	URL string `mapstructure:"url"`
	// Secret is the bearer token of that POST.
	Secret string `mapstructure:"secret"`
}

// validate checks the hook. hasTrigger says whether the config names a
// trigger secret: without the trigger nothing the hook wakes could deliver.
func (c WebhookWakeConfig) validate(hasTrigger bool) error {
	if c.URL == "" {
		if c.Secret != "" {
			return errors.New("events.webhooks.wake.secret is set without events.webhooks.wake.url")
		}
		return nil
	}
	// The message names no part of the URL, whose query may be a credential.
	if target, err := url.Parse(c.URL); err != nil || target.Scheme != "https" || target.Host == "" || target.User != nil {
		return errors.New("events.webhooks.wake.url must be an https URL without userinfo")
	}
	if err := CheckTriggerSecret(c.Secret); err != nil {
		return fmt.Errorf("events.webhooks.wake.secret %w", err)
	}
	if !hasTrigger {
		return errors.New("events.webhooks.wake.url needs events.webhooks.trigger_secret: what the hook wakes calls " + WebhookTriggerPath)
	}
	return nil
}

const (
	// webhookWakeDelay is how long the loop waits after a wake-up before the
	// round it asked for, and webhookWakeEvery the least time between two
	// such rounds: an event is on its way within the first, and a burst of
	// them costs one round per the second.
	webhookWakeDelay = 100 * time.Millisecond
	webhookWakeEvery = time.Second
	// webhookFiltersTTL is for how long the server remembers which event
	// types a project's enabled webhooks take, and so the longest a new
	// webhook waits for its first wake-up when another server stored the
	// event. The timer, or the scheduled round, delivers that one.
	webhookFiltersTTL = 5 * time.Second
	// webhookFiltersLimit is how many projects are remembered before the
	// memory is dropped.
	webhookFiltersLimit = 4096
	// webhookWakeTimeout bounds what a wake-up adds to the request that
	// stored the event: reading the project's webhooks and the call to the
	// hook. After a call that failed none is made for webhookWakePause, so a
	// hook that does not answer slows one request, not each.
	webhookWakeTimeout = 2 * time.Second
	webhookWakePause   = 10 * time.Second
)

// webhookWake is what a WebhookShipper does with a wake-up: a round of its
// own loop, or a call to the hook when a trigger runs it.
type webhookWake struct {
	cfg WebhookWakeConfig
	// client calls the hook. Its URL is the operator's, so it is not the
	// hardened client the deliveries go through (ADR 061 decision 2).
	client *http.Client
	// loops says that the shipper's loop runs and takes the wake-ups.
	loops        bool
	delay, every time.Duration
	// signal tells the loop that pending is not empty.
	signal chan struct{}

	mu sync.Mutex
	// pending are the projects woken since the loop last took them, with the
	// types of the events stored.
	pending map[string][]domain.EventType
	filters map[string]webhookFilters
	// pausedUntil is until when no call to the hook is made.
	pausedUntil time.Time
}

// webhookFilters is WebhookSource.WebhookEventTypes of a project as read at.
type webhookFilters struct {
	eventTypes []string
	at         time.Time
}

func newWebhookWake(cfg WebhookWakeConfig) *webhookWake {
	return &webhookWake{
		cfg: cfg,
		//egress:allow operator-configured wake hook, not user-injectable (ADR 061)
		client:  &http.Client{Timeout: webhookWakeTimeout},
		delay:   webhookWakeDelay,
		every:   webhookWakeEvery,
		signal:  make(chan struct{}, 1),
		pending: map[string][]domain.EventType{},
		filters: map[string]webhookFilters{},
	}
}

// take returns the pending projects and leaves none.
func (w *webhookWake) take() map[string][]domain.EventType {
	w.mu.Lock()
	defer w.mu.Unlock()
	pending := w.pending
	w.pending = map[string][]domain.EventType{}
	return pending
}

// Wake tells the shipper that events of eventTypes were stored in the
// project, committed: service.DB calls it after each transaction that wrote
// one. It never fails and returns at once, except on a server with a wake
// hook, where it takes as long as the call to the hook, at most
// webhookWakeTimeout.
//
//   - With the loop running, the project's webhooks get a round shortly,
//     shared with whatever else is woken until then.
//   - With a trigger and a wake hook, the hook is called.
//   - With a trigger alone, nothing happens: the scheduler's next call
//     delivers.
//
// A project none of whose enabled webhooks takes one of the types costs
// nothing more than a look into the server's memory, and every
// webhookFiltersTTL one read of its webhooks.
func (s *WebhookShipper) Wake(ctx context.Context, projectID string, eventTypes []domain.EventType) {
	if !s.cfg.Enabled || projectID == "" {
		return
	}
	w := s.wake
	if w.loops {
		w.mu.Lock()
		w.pending[projectID] = append(w.pending[projectID], eventTypes...)
		w.mu.Unlock()
		select {
		case w.signal <- struct{}{}:
		default:
		}
		return
	}
	if w.cfg.URL == "" {
		return
	}
	// The request may have ended, and the event is stored either way.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), webhookWakeTimeout)
	defer cancel()
	if len(s.wantedOf(ctx, map[string][]domain.EventType{projectID: eventTypes})) > 0 {
		s.callWakeHook(ctx, projectID, time.Time{})
	}
}

// wantedOf returns the woken projects that have an enabled webhook taking
// one of the event types stored. A project whose webhooks cannot be read is
// left out: the timer or the scheduled round delivers.
func (s *WebhookShipper) wantedOf(ctx context.Context, woken map[string][]domain.EventType) []string {
	var wanted []string
	for projectID, stored := range woken {
		filters, err := s.webhookFilters(ctx, projectID, stored)
		if err != nil {
			if ctx.Err() == nil {
				zlog.Warn(ctx, "webhook shipper: wake-up dropped, reading the project's webhooks failed",
					slog.String("project_id", projectID), slog.String("error", err.Error()))
			}
			continue
		}
		if slices.ContainsFunc(stored, func(eventType domain.EventType) bool { return webhookWants(filters, eventType) }) {
			wanted = append(wanted, projectID)
		}
	}
	return wanted
}

// webhookFilters returns the event types the project's enabled webhooks
// take, from memory while it is no older than webhookFiltersTTL. An event
// that says the project's webhooks changed makes it read them anew, so the
// server that created a webhook wakes it from its first event on.
func (s *WebhookShipper) webhookFilters(ctx context.Context, projectID string, stored []domain.EventType) ([]string, error) {
	w := s.wake
	now := s.now()
	changed := slices.ContainsFunc(stored, func(eventType domain.EventType) bool {
		switch eventType {
		case domain.EventTypeWebhookCreated, domain.EventTypeWebhookUpdated, domain.EventTypeWebhookDeleted, domain.EventTypeWebhookDisabled:
			return true
		}
		return false
	})
	w.mu.Lock()
	known, ok := w.filters[projectID]
	w.mu.Unlock()
	if ok && !changed && now.Sub(known.at) < webhookFiltersTTL {
		return known.eventTypes, nil
	}
	ctx, cancel := context.WithTimeout(ctx, shipListTimeout)
	defer cancel()
	eventTypes, err := s.src.WebhookEventTypes(ctx, projectID)
	if err != nil {
		return nil, err
	}
	w.mu.Lock()
	if len(w.filters) >= webhookFiltersLimit {
		clear(w.filters)
	}
	w.filters[projectID] = webhookFilters{eventTypes: eventTypes, at: now}
	w.mu.Unlock()
	return eventTypes, nil
}

// webhookWakeCall is the body of a call to the wake hook.
type webhookWakeCall struct {
	ProjectID string `json:"project_id"`
	// NotBefore is from when the project has something to deliver: the next
	// attempt after a failed delivery. Without it, it has now.
	NotBefore *time.Time `json:"not_before,omitempty"`
}

// callWakeHook tells the hook, if the config names one, that the project
// has something to deliver from notBefore on, or now when that is zero. It
// is best effort: a call that fails is logged, and holds back the calls of
// the next webhookWakePause.
func (s *WebhookShipper) callWakeHook(ctx context.Context, projectID string, notBefore time.Time) {
	w := s.wake
	if w.cfg.URL == "" {
		return
	}
	w.mu.Lock()
	paused := s.now().Before(w.pausedUntil)
	w.mu.Unlock()
	if paused {
		return
	}
	call := webhookWakeCall{ProjectID: projectID}
	if !notBefore.IsZero() {
		call.NotBefore = new(notBefore.UTC())
	}
	if err := w.post(ctx, call); err != nil {
		w.mu.Lock()
		w.pausedUntil = s.now().Add(webhookWakePause)
		w.mu.Unlock()
		// Cut down to its cause, as a failed delivery's is: the client's
		// error holds the URL, whose query may be a credential.
		if urlErr, ok := errors.AsType[*url.Error](err); ok {
			err = urlErr.Err
		}
		zlog.Warn(ctx, "webhook shipper: wake hook failed", slog.String("project_id", projectID), slog.String("error", err.Error()))
	}
}

func (w *webhookWake) post(ctx context.Context, call webhookWakeCall) error {
	body, err := json.Marshal(call)
	if err != nil {
		return err
	}
	// Not the caller's deadline alone: a delivery that failed as its budget
	// ran out still asks for its next attempt.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), webhookWakeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.cfg.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+w.cfg.Secret)
	resp, err := w.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.CopyN(io.Discard, resp.Body, webhookResponseLimit)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

// wakeForTheRest asks the hook for another round when a round that gave its
// lease back left events its webhook takes: those past its budget, and those
// stored while it held the lease, whose own wake-up found the webhook taken.
// A server with a timer needs none of it; its next tick is that round.
func (s *WebhookShipper) wakeForTheRest(ctx context.Context, hook *domain.Webhook) {
	if s.wake.cfg.URL == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), webhookWriteTimeout)
	defer cancel()
	rest, err := s.src.ListEventsAfterCursor(ctx, hook.ProjectID, hook.CursorCreatedAt, hook.CursorEventID, webhookPageSize)
	if err != nil {
		return
	}
	// A full page may hide an event the webhook takes behind those it skips.
	if len(rest) == webhookPageSize || slices.ContainsFunc(rest, func(ev *domain.Event) bool { return webhookWants(hook.EventTypes, ev.EventType) }) {
		s.callWakeHook(ctx, hook.ProjectID, time.Time{})
	}
}
