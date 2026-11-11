package audit

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/instrumentation/errlog"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// WebhookConfig controls delivery to the projects' webhooks (ADR 088 §4). It
// is apart from ExportConfig: that one is the operator's export to the sinks
// the configuration names, off unless asked for; a webhook is a customer's,
// who expects delivery once it exists.
type WebhookConfig struct {
	Enabled bool `mapstructure:"enabled"`
	// Interval is how often the server looks for webhooks with events to
	// deliver, and so the longest an event waits for its first attempt.
	Interval time.Duration `mapstructure:"interval"`
	// TriggerSecret hands the schedule to something outside the process, as
	// RetentionConfig.TriggerSecret does: set, the server runs no loop of
	// its own and delivers once per request to WebhookTriggerPath that
	// carries it as a bearer token.
	TriggerSecret string `mapstructure:"trigger_secret"`
	// Wake names where a server that keeps no timer says that a project has
	// something to deliver (webhook_wake.go).
	Wake WebhookWakeConfig `mapstructure:"wake"`
}

// WebhookTriggerPath is where a scheduler starts one round of delivery when
// the config names a trigger secret. Like RetentionTriggerPath it is the
// deployment operator's, outside the API.
const WebhookTriggerPath = "/cron/events-webhooks"

func DefaultWebhookConfig() WebhookConfig {
	return WebhookConfig{Enabled: true, Interval: 5 * time.Second}
}

// Validate applies RetentionConfig.Validate's rule to the trigger secret,
// and checks the wake hook, which only a server with a trigger can use: what
// the hook wakes calls the trigger.
func (c WebhookConfig) Validate() error {
	if c.TriggerSecret != "" {
		if err := CheckTriggerSecret(c.TriggerSecret); err != nil {
			return fmt.Errorf("events.webhooks.trigger_secret %w", err)
		}
	}
	return c.Wake.validate(c.TriggerSecret != "")
}

const (
	// webhookRequestTimeout is the deadline of one delivery (ADR 088 §4).
	webhookRequestTimeout = 10 * time.Second
	// webhookBudget is how long one round works on one webhook. A webhook
	// with more to deliver than fits continues in the next round.
	webhookBudget = 30 * time.Second
	// webhookWriteTimeout bounds each write of a webhook's state. Those
	// writes do not run under the budget: the one that ends a round must go
	// through when the budget is spent.
	webhookWriteTimeout = 10 * time.Second
	// webhookLeaseTTL is how long a server holds a webhook before another
	// may take it over: the budget, and room for the writes around it.
	webhookLeaseTTL = webhookBudget + 2*webhookWriteTimeout + 10*time.Second
	// webhookWorkers is how many webhooks one server delivers to at once.
	webhookWorkers  = 16
	webhookPageSize = shipPageSize
	// webhookResponseLimit is how much of a response is read, to let the
	// connection be reused, before it is closed.
	webhookResponseLimit = 64 << 10

	webhookBackoffMin = 5 * time.Second
	webhookBackoffMax = time.Hour

	// webhookTriggerTimeout bounds a round a request starts, as
	// retentionTriggerTimeout bounds a purge.
	webhookTriggerTimeout = retentionTriggerTimeout
)

// WebhookClientConfig is the hardened egress client's configuration for
// deliveries (ADR 061, ADR 088 §4): the deployment's deny and allow lists,
// with no redirect followed and the delivery deadline. The response size is
// not capped here, which would fail a delivery the endpoint acknowledged at
// length; the shipper reads a bounded part and drops the rest.
func WebhookClientConfig(egress httputil.ClientConfig) httputil.ClientConfig {
	return httputil.ClientConfig{
		Timeout:   webhookRequestTimeout,
		DenyList:  egress.DenyList,
		AllowList: egress.AllowList,
	}
}

// WebhookSource backs the webhook shipper with the webhooks, their events
// and their state. Its writes on a leased webhook return
// *database.NoRowFoundError once the holder has lost the lease.
type WebhookSource interface {
	// LeaseDueWebhooks is service.WebhookStatements.LeaseDueWebhooks.
	LeaseDueWebhooks(ctx context.Context, projectID, holder string, dueBy, now, leaseUntil time.Time, limit int) ([]*domain.Webhook, error)
	// WebhookEventTypes returns the filters of the project's enabled
	// webhooks together, empty when it has none: what a wake-up is weighed
	// against before it costs anything.
	WebhookEventTypes(ctx context.Context, projectID string) ([]string, error)
	// WebhookEventsVisible is the pre-claim gate of ADR 049 §4 for a
	// project's own readers: true once the project is claimed, and always
	// for the platform project.
	WebhookEventsVisible(ctx context.Context, projectID string) (bool, error)
	ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) ([]*domain.Event, error)
	// WebhookSecrets decrypts the secrets that sign a delivery at at: the
	// webhook's, and the one a rotation replaced while it has not expired.
	WebhookSecrets(ctx context.Context, hook *domain.Webhook, at time.Time) ([]string, error)
	// RecordWebhookProgress stores the webhook's cursor. With deliveredAt, a
	// delivery succeeded then.
	RecordWebhookProgress(ctx context.Context, hook *domain.Webhook, holder string, deliveredAt *time.Time) error
	RecordWebhookFailure(ctx context.Context, hook *domain.Webhook, holder string, at time.Time, status *int32, nextAttemptAt time.Time) error
	// DisableWebhook disables the webhook after a failed delivery and writes
	// its webhook.disabled event, in one transaction.
	DisableWebhook(ctx context.Context, hook *domain.Webhook, holder string, at time.Time, status *int32, reason domain.WebhookDisabledReason) error
	ReleaseWebhookLease(ctx context.Context, hook *domain.Webhook, holder string, nextAttemptAt time.Time) error
}

// WebhookShipper delivers the projects' events to their webhooks, signed
// (ADR 088 §2 to §4): on its own timer and as soon as Wake says a project
// has new events, or once per request to its trigger when the config names a
// trigger secret.
//
// It stands beside Shipper rather than inside it. The two share the event
// listing and nothing else: a webhook gets its own body (webhookEvent), it is
// leased, filtered, signed, backed off and given up on, its cursor is on its
// row, and its URL is a customer's, so it goes through the hardened client.
type WebhookShipper struct {
	cfg    WebhookConfig
	src    WebhookSource
	client *http.Client
	// holder names this server in a lease. It is new with every start, so a
	// server that restarts does not take up its old leases.
	holder string
	now    func() time.Time
	// slots holds a token per webhook being delivered to.
	slots chan struct{}
	stop  chan struct{}
	done  chan struct{}
	// running are the deliveries the loop started.
	running sync.WaitGroup

	// wake is what Wake does with a project that has something to deliver:
	// see webhook_wake.go.
	wake *webhookWake
}

// NewWebhookShipper builds the shipper. client must be the hardened egress
// client built from WebhookClientConfig.
func NewWebhookShipper(src WebhookSource, client *http.Client, cfg WebhookConfig) *WebhookShipper {
	if cfg.Interval <= 0 {
		cfg.Interval = DefaultWebhookConfig().Interval
	}
	holder := make([]byte, 16)
	// crypto/rand.Read does not fail (it aborts the process instead).
	_, _ = rand.Read(holder)
	wake := newWebhookWake(cfg.Wake)
	// As Start decides it: the loop takes the wake-ups, a trigger's hook
	// gets them otherwise.
	wake.loops = cfg.Enabled && cfg.TriggerSecret == ""
	return &WebhookShipper{
		cfg:    cfg,
		src:    src,
		client: client,
		holder: hex.EncodeToString(holder),
		now:    time.Now,
		slots:  make(chan struct{}, webhookWorkers),
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
		wake:   wake,
	}
}

// Start starts the loop, unless delivery is off or a trigger runs it.
func (s *WebhookShipper) Start() {
	if !s.cfg.Enabled || s.cfg.TriggerSecret != "" {
		close(s.done)
		return
	}
	go s.loop()
}

func (s *WebhookShipper) loop() {
	defer close(s.done)
	// Cancelled by Close: deliveries stop where they are and give their
	// leases back.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		select {
		case <-s.stop:
			cancel()
		case <-ctx.Done():
		}
	}()
	ticker := time.NewTicker(s.cfg.Interval)
	defer ticker.Stop()
	// woken fires when the projects Wake named get their round: a moment
	// after the first of them, so that what a request writes in several
	// transactions, and a burst of requests, share it.
	woken := time.NewTimer(0)
	<-woken.C
	defer woken.Stop()
	var armed bool
	var lastWoken time.Time
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			// The loop does not wait for the deliveries it starts, so a slow
			// endpoint holds one worker and nobody else's next round.
			if _, err := s.dispatch(ctx, "", &s.running); err != nil && ctx.Err() == nil {
				slog.Error("webhook shipper: lease due webhooks failed", slog.String("error", err.Error()))
			}
		case <-s.wake.signal:
			if armed {
				continue
			}
			armed = true
			woken.Reset(max(s.wake.delay, time.Until(lastWoken.Add(s.wake.every))))
		case <-woken.C:
			armed, lastWoken = false, time.Now()
			for _, projectID := range s.wantedOf(ctx, s.wake.take()) {
				if _, err := s.dispatch(ctx, projectID, &s.running); err != nil && ctx.Err() == nil {
					slog.Error("webhook shipper: lease woken webhooks failed", slog.String("project_id", projectID), slog.String("error", err.Error()))
				}
			}
		}
	}
}

// runOnce is one round: it delivers to every webhook that is due as it
// starts, of projectID or with it empty of every project, and returns when
// those deliveries have ended.
func (s *WebhookShipper) runOnce(ctx context.Context, projectID string) (int, error) {
	var running sync.WaitGroup
	defer running.Wait()
	return s.dispatch(ctx, projectID, &running)
}

// dispatch leases the due webhooks, of projectID or with it empty of every
// project, as many at a time as there are free workers, and starts a
// delivery for each on running. It returns how many it started, once a lease
// finds no more.
//
// A webhook counts as due against the time the round started. A delivery
// that ends gives its webhook back due from then, which is later, so the
// round does not take the same webhook twice.
func (s *WebhookShipper) dispatch(ctx context.Context, projectID string, running *sync.WaitGroup) (int, error) {
	dueBy := s.now()
	started := 0
	for {
		// Wait for one free worker, then take the others that are free.
		select {
		case s.slots <- struct{}{}:
		case <-ctx.Done():
			return started, ctx.Err()
		}
		free := 1
		for free < cap(s.slots) {
			select {
			case s.slots <- struct{}{}:
				free++
				continue
			default:
			}
			break
		}
		hooks, err := s.leaseDue(ctx, projectID, dueBy, free)
		for range free - len(hooks) {
			<-s.slots
		}
		if err != nil {
			return started, err
		}
		if len(hooks) == 0 {
			return started, nil
		}
		started += len(hooks)
		for _, hook := range hooks {
			running.Go(func() {
				defer func() { <-s.slots }()
				s.ship(ctx, hook)
			})
		}
	}
}

// leaseDue leases up to limit due webhooks under a job span of its own, ended
// before any is delivered to.
func (s *WebhookShipper) leaseDue(ctx context.Context, projectID string, dueBy time.Time, limit int) ([]*domain.Webhook, error) {
	ctx, span := startJobSpan(ctx, "audit.LeaseDueWebhooks")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, shipListTimeout)
	defer cancel()
	now := s.now()
	hooks, err := s.src.LeaseDueWebhooks(ctx, projectID, s.holder, dueBy, now, now.Add(webhookLeaseTTL), limit)
	if err != nil {
		failJobSpan(ctx, err)
	}
	return hooks, err
}

// ship delivers a leased webhook's pending events under its own job span and
// within its own budget, then gives the lease back.
func (s *WebhookShipper) ship(parent context.Context, hook *domain.Webhook) {
	parent, span := startJobSpan(parent, "audit.ShipWebhook",
		attribute.String("zitadel.webhook.id", hook.ID),
		attribute.String("zitadel.project.id", hook.ProjectID),
	)
	defer span.End()
	ctx, cancel := context.WithTimeout(parent, webhookBudget)
	defer cancel()

	held, reached, err := s.deliverPending(ctx, hook)
	if err != nil {
		failJobSpan(ctx, err)
		// The round's context, not the webhook's: a webhook that ran out of
		// its budget is an Error, a server that is stopping a Warn.
		s.logFault(parent, "webhook shipper: delivery stopped", hook, err)
	}
	if !held {
		return
	}
	err = s.write(parent, func(ctx context.Context) error {
		return s.src.ReleaseWebhookLease(ctx, hook, s.holder, s.now())
	})
	if err != nil && !leaseLost(err) {
		failJobSpan(ctx, err)
		s.logFault(parent, "webhook shipper: release lease failed", hook, err)
	}
	if err == nil && reached {
		s.wakeForTheRest(parent, hook)
	}
}

// deliverPending sends the webhook the project's settled events after its
// cursor, oldest first, until none is left, one fails or the budget runs
// low. held says whether the lease is still to give back: a failed delivery
// gives it back with what it records, and a lease that was lost is nobody's
// to give. reached says that the round ended at the cursor it stored, with
// nothing in its way but its budget or the end of what it listed. err is a
// fault of the server's own, never a failed delivery.
func (s *WebhookShipper) deliverPending(ctx context.Context, hook *domain.Webhook) (held, reached bool, err error) {
	visible, err := s.src.WebhookEventsVisible(ctx, hook.ProjectID)
	if err != nil || !visible {
		return true, false, err
	}
	var secrets []string
	for {
		batch, err := s.src.ListEventsAfterCursor(ctx, hook.ProjectID, hook.CursorCreatedAt, hook.CursorEventID, webhookPageSize)
		if err != nil || len(batch) == 0 {
			return true, err == nil, err
		}
		var (
			moved       bool
			deliveredAt *time.Time
			failure     *webhookFailure
			outOfBudget bool
		)
		for _, ev := range batch {
			if webhookWants(hook.EventTypes, ev.EventType) {
				// A request must not be cut short by the budget: that would
				// read as the endpoint's failure.
				if deadline, ok := ctx.Deadline(); (ok && time.Until(deadline) < webhookRequestTimeout) || ctx.Err() != nil {
					outOfBudget = true
					break
				}
				at := s.now()
				if secrets == nil {
					secrets, err = s.src.WebhookSecrets(ctx, hook, at)
					if err != nil {
						failure = &webhookFailure{at: at, eventID: ev.ID, cause: err}
						break
					}
				}
				if failure = s.send(ctx, hook, ev, secrets, at); failure != nil {
					break
				}
				deliveredAt = &at
				hook.FailingSince = nil
			}
			hook.CursorCreatedAt, hook.CursorEventID = ev.CreatedAt, ev.ID
			moved = true
		}
		if moved {
			err := s.write(ctx, func(ctx context.Context) error {
				return s.src.RecordWebhookProgress(ctx, hook, s.holder, deliveredAt)
			})
			if err != nil {
				return !leaseLost(err), false, ignoreLeaseLost(err)
			}
		}
		if failure != nil {
			if ctx.Err() != nil {
				// The server is stopping or the round was cancelled: the
				// request did not fail, it was given up.
				return true, false, nil
			}
			return false, false, ignoreLeaseLost(s.fail(ctx, hook, failure))
		}
		if outOfBudget || len(batch) < webhookPageSize {
			return true, true, nil
		}
	}
}

// webhookWants reports whether a webhook's filter takes an event type: a type
// it lists, or every type but request.api when it lists "*" (ADR 088 §1).
func webhookWants(eventTypes []string, eventType domain.EventType) bool {
	for _, want := range eventTypes {
		if want == domain.WebhookAllEventTypes {
			return eventType != domain.EventTypeRequestAPI
		}
		if want == string(eventType) {
			return true
		}
	}
	return false
}

// webhookBackoff is how long the next attempt waits after a failure, given
// for how long the webhook has been failing (zero at its first failure):
// that long again and 5 seconds, at most 1 hour. With attempts made on time
// the waits are 5, 10, 20, 40 seconds and so on (ADR 088 §4), and nothing
// but the time of the first failure has to be stored.
func webhookBackoff(failingFor time.Duration) time.Duration {
	return min(max(failingFor, 0)+webhookBackoffMin, webhookBackoffMax)
}

// webhookFailure is one delivery that failed: the endpoint's answer, or the
// reason there was none.
type webhookFailure struct {
	at      time.Time
	eventID string
	// status is the HTTP status of the answer, nil when there was none.
	status *int32
	cause  error
}

// reason is the failure for a log line. An error of the HTTP client is cut
// down to its cause, since its message holds the full URL, whose path or
// query may be a token.
func (f *webhookFailure) reason() string {
	if f.cause == nil {
		return "status " + strconv.Itoa(int(*f.status))
	}
	if urlErr, ok := errors.AsType[*url.Error](f.cause); ok {
		return urlErr.Err.Error()
	}
	return f.cause.Error()
}

// send makes one delivery attempt (ADR 088 §2) and returns nil when the
// endpoint acknowledged it with a 2xx.
func (s *WebhookShipper) send(ctx context.Context, hook *domain.Webhook, ev *domain.Event, secrets []string, at time.Time) (failure *webhookFailure) {
	failure = &webhookFailure{at: at, eventID: ev.ID}
	defer func() {
		result := metrics.WebhookDelivered
		if failure != nil {
			result = metrics.WebhookFailed
		}
		metrics.RecordWebhookDelivery(ctx, result)
	}()

	body, err := marshalWebhookEvent(ev)
	if err != nil {
		failure.cause = err
		return failure
	}
	signature, err := signWebhook(secrets, ev.ID, at, body)
	if err != nil {
		failure.cause = err
		return failure
	}
	// The API stores only such a URL; a row that holds another is not sent
	// to: http would show the event to the network, and userinfo would
	// become a credential the customer never set as one.
	target, err := url.Parse(hook.URL)
	if err != nil || target.Scheme != "https" || target.User != nil {
		failure.cause = errors.New("webhook url is not an https URL without userinfo")
		return failure
	}
	ctx, cancel := context.WithTimeout(ctx, webhookRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, hook.URL, bytes.NewReader(body))
	if err != nil {
		failure.cause = err
		return failure
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webhookIDHeader, ev.ID)
	req.Header.Set(webhookTimestampHeader, strconv.FormatInt(at.Unix(), 10))
	req.Header.Set(webhookSignatureHeader, signature)

	resp, err := s.client.Do(req)
	if resp != nil {
		// Also beside an error: a redirect the client refused to follow
		// comes with the response that asked for it, its body closed.
		failure.status = new(int32(resp.StatusCode))
	}
	if err != nil {
		failure.cause = err
		return failure
	}
	defer resp.Body.Close()
	_, _ = io.CopyN(io.Discard, resp.Body, webhookResponseLimit)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return failure
	}
	return nil
}

// fail records a failed delivery, which ends the round for the webhook: the
// events after it wait (ADR 088 §4). It sets the next attempt, or disables
// the webhook when the endpoint is gone or has failed for too long.
func (s *WebhookShipper) fail(ctx context.Context, hook *domain.Webhook, failure *webhookFailure) error {
	failingSince := failure.at
	if hook.FailingSince != nil {
		failingSince = *hook.FailingSince
	}
	failingFor := failure.at.Sub(failingSince)

	attrs := []any{
		slog.String("webhook_id", hook.ID),
		slog.String("project_id", hook.ProjectID),
		slog.String("event_id", failure.eventID),
		slog.String("reason", failure.reason()),
	}
	var reason domain.WebhookDisabledReason
	switch {
	case failure.status != nil && *failure.status == http.StatusGone:
		reason = domain.WebhookDisabledReasonGone
	case failingFor >= domain.WebhookDisableAfter:
		reason = domain.WebhookDisabledReasonFailing
	default:
		zlog.Info(ctx, "webhook shipper: delivery failed", attrs...)
		nextAttemptAt := failure.at.Add(webhookBackoff(failingFor))
		err := s.write(ctx, func(ctx context.Context) error {
			return s.src.RecordWebhookFailure(ctx, hook, s.holder, failure.at, failure.status, nextAttemptAt)
		})
		if err == nil {
			// No timer of this server's will make that attempt.
			s.callWakeHook(ctx, hook.ProjectID, nextAttemptAt)
		}
		return err
	}
	zlog.Info(ctx, "webhook shipper: delivery failed, webhook disabled", append(attrs, slog.String("disabled_reason", string(reason)))...)
	return s.write(ctx, func(ctx context.Context) error {
		return s.src.DisableWebhook(ctx, hook, s.holder, failure.at, failure.status, reason)
	})
}

// write runs a write of a webhook's state with a deadline of its own, also
// when ctx has ended: what a delivery did must be recorded, and its lease
// given back, after the budget is spent or the server was told to stop.
func (s *WebhookShipper) write(ctx context.Context, fn func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), webhookWriteTimeout)
	defer cancel()
	return fn(ctx)
}

func leaseLost(err error) bool {
	return errors.Is(err, new(database.NoRowFoundError))
}

// ignoreLeaseLost drops the error of a write that found the lease lost: the
// webhook was deleted or enabled anew, or another server took it over, and
// each of those is in order.
func ignoreLeaseLost(err error) error {
	if leaseLost(err) {
		return nil
	}
	return err
}

func (s *WebhookShipper) logFault(ctx context.Context, msg string, hook *domain.Webhook, err error) {
	errlog.LogFault(ctx, fmt.Errorf("%s: webhook %s of project %s: %w", msg, hook.ID, hook.ProjectID, err))
}

// WebhookTriggerProjectParam is the query parameter that keeps a triggered
// round to one project's webhooks: what a wake-up for that project calls.
const WebhookTriggerProjectParam = "project_id"

// Trigger is the handler that runs one round per GET or POST that carries
// the trigger secret as a bearer token, and answers how many webhooks the
// round delivered to. With WebhookTriggerProjectParam the round is that
// project's, otherwise every project's. It is nil unless delivery is on and
// the config names a trigger secret.
func (s *WebhookShipper) Trigger() http.Handler {
	if !s.cfg.Enabled || s.cfg.TriggerSecret == "" {
		return nil
	}
	secret := hashTriggerSecret(s.cfg.TriggerSecret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authorizeTrigger(w, r, secret) {
			return
		}
		// A round may outlast the server's write timeout, as a purge may.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(webhookTriggerTimeout + 10*time.Second))

		ctx, cancel := context.WithTimeout(r.Context(), webhookTriggerTimeout)
		defer cancel()
		n, err := s.runOnce(ctx, r.URL.Query().Get(WebhookTriggerProjectParam))
		if err != nil {
			errlog.LogFault(r.Context(), err)
			http.Error(w, "webhook delivery: round failed", http.StatusInternalServerError)
			return
		}
		zlog.Info(ctx, "webhook shipper: round done", slog.Int("webhooks", n))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = fmt.Fprintf(w, "{\"webhooks\":%d}\n", n)
	})
}

// Close stops the loop and waits for the deliveries it started, which stop
// at the request they are in and give their leases back.
func (s *WebhookShipper) Close() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
	<-s.done
	s.running.Wait()
}
