package audit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	testWebhookSecret    = "whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oDZJQk1o3DdH8="
	testWebhookOldSecret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
)

// The vector the Standard Webhooks reference libraries pin in their own
// tests (standard-webhooks/standard-webhooks, "sign function works"): the
// key is the base64 after whsec_, the signed content is id.timestamp.body.
func TestSignWebhook_StandardWebhooksVector(t *testing.T) {
	signature, err := signWebhook(
		[]string{"whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"},
		"msg_p5jXN8AQM9LWM0D4loKWxJek",
		time.Unix(1614265330, 0),
		[]byte(`{"test": 2432232314}`),
	)
	require.NoError(t, err)
	assert.Equal(t, "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=", signature)
}

// During a rotation a delivery carries one signature per secret, separated
// by a space, each the one that secret alone would give (ADR 088 §3).
func TestSignWebhook_OneSignaturePerSecret(t *testing.T) {
	at := time.Unix(1794391200, 0)
	body := []byte(`{"id":"evt_1"}`)
	newest, err := signWebhook([]string{testWebhookSecret}, "evt_1", at, body)
	require.NoError(t, err)
	previous, err := signWebhook([]string{testWebhookOldSecret}, "evt_1", at, body)
	require.NoError(t, err)

	both, err := signWebhook([]string{testWebhookSecret, testWebhookOldSecret}, "evt_1", at, body)
	require.NoError(t, err)
	assert.Equal(t, newest+" "+previous, both)
	assert.NotEqual(t, newest, previous)
}

// Nothing is signed with a key that is not the secret's: a delivery fails
// instead (ADR 088 §3).
func TestSignWebhook_RefusesWhatIsNotASecret(t *testing.T) {
	for name, secrets := range map[string][]string{
		"no secret":         nil,
		"no prefix":         {"C2FVsBQIhrscChlQIMV+b5sSYspob7oDZJQk1o3DdH8="},
		"not base64":        {"whsec_not base64!"},
		"an empty key":      {"whsec_"},
		"one of two is bad": {testWebhookSecret, "ciphertext"},
	} {
		t.Run(name, func(t *testing.T) {
			signature, err := signWebhook(secrets, "evt_1", time.Unix(1, 0), []byte("{}"))
			require.ErrorIs(t, err, errWebhookSecretMalformed)
			assert.Empty(t, signature)
		})
	}
}

func TestWebhookWants(t *testing.T) {
	for _, tc := range []struct {
		name       string
		eventTypes []string
		eventType  domain.EventType
		want       bool
	}{
		{"a listed type", []string{"user.created", "user.deleted"}, domain.EventTypeUserDeleted, true},
		{"a type not listed", []string{"user.created"}, domain.EventTypeUserUpdated, false},
		{"a prefix is not a match", []string{"user.created"}, domain.EventTypeUserCreateFailed, false},
		{"* takes every type", []string{"*"}, domain.EventTypeWebhookDisabled, true},
		{"* takes a type added later", []string{"*"}, "thing.invented", true},
		{"* leaves request.api out", []string{"*"}, domain.EventTypeRequestAPI, false},
		{"request.api when named", []string{"request.api"}, domain.EventTypeRequestAPI, true},
		{"a stored type the server no longer knows matches nothing", []string{"thing.retired"}, domain.EventTypeUserCreated, false},
		{"no entry", nil, domain.EventTypeUserCreated, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, webhookWants(tc.eventTypes, tc.eventType))
		})
	}
}

// From 5 seconds, doubling, to at most 1 hour (ADR 088 §4), when every
// attempt is made as it falls due.
func TestWebhookBackoff_Schedule(t *testing.T) {
	var got []time.Duration
	var failingFor time.Duration
	for range 12 {
		wait := webhookBackoff(failingFor)
		got = append(got, wait)
		failingFor += wait
	}
	assert.Equal(t, []time.Duration{
		5 * time.Second, 10 * time.Second, 20 * time.Second, 40 * time.Second, 80 * time.Second,
		160 * time.Second, 320 * time.Second, 640 * time.Second, 1280 * time.Second, 2560 * time.Second,
		time.Hour, time.Hour,
	}, got)
	assert.Equal(t, 5*time.Second, webhookBackoff(-time.Minute), "a clock that stepped back")
}

// A failure's log line names no URL: the HTTP client's error holds the whole
// one, whose path or query may be a token.
func TestWebhookFailure_ReasonHoldsNoURL(t *testing.T) {
	failure := &webhookFailure{cause: &url.Error{
		Op: "Post", URL: "https://hooks.example.com/in/tok_secret?key=k_secret", Err: errors.New("connection refused"),
	}}
	assert.Equal(t, "connection refused", failure.reason())
	assert.Equal(t, "status 503", (&webhookFailure{status: new(int32(503))}).reason())
}

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = t
}

type fakeDisable struct {
	hookID string
	status *int32
	reason domain.WebhookDisabledReason
}

// fakeWebhookSource keeps webhooks as the statements do: a lease goes to one
// holder at a time, and a write needs the lease.
type fakeWebhookSource struct {
	mu sync.Mutex

	hooks  map[string]*domain.Webhook
	events map[string][]*domain.Event // by project, in order
	hidden map[string]bool            // projects the pre-claim gate hides

	secrets    []string
	secretsErr error
	leaseErr   error
	// loseLeaseOnProgress drops the lease as progress is written, as when
	// the webhook is enabled anew under a delivery.
	loseLeaseOnProgress bool

	// leases are the projects LeaseDueWebhooks was called for, and
	// filterReads the calls to WebhookEventTypes.
	leases      []string
	filterReads int
	filtersErr  error

	progress int
	disabled []fakeDisable
	released []string
}

func newFakeWebhookSource(hooks ...*domain.Webhook) *fakeWebhookSource {
	f := &fakeWebhookSource{
		hooks:   map[string]*domain.Webhook{},
		events:  map[string][]*domain.Event{},
		hidden:  map[string]bool{},
		secrets: []string{testWebhookSecret},
	}
	for _, hook := range hooks {
		f.hooks[hook.ID] = hook
	}
	return f
}

func (f *fakeWebhookSource) get(id string) domain.Webhook {
	f.mu.Lock()
	defer f.mu.Unlock()
	return *f.hooks[id]
}

func (f *fakeWebhookSource) addEvents(projectID string, evs ...*domain.Event) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events[projectID] = append(f.events[projectID], evs...)
}

func (f *fakeWebhookSource) LeaseDueWebhooks(_ context.Context, projectID, holder string, dueBy, now, leaseUntil time.Time, limit int) ([]*domain.Webhook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.leases = append(f.leases, projectID)
	if f.leaseErr != nil {
		return nil, f.leaseErr
	}
	var out []*domain.Webhook
	for _, hook := range f.hooks {
		if len(out) == limit {
			break
		}
		if !hook.Enabled || (projectID != "" && hook.ProjectID != projectID) ||
			(hook.NextAttemptAt != nil && hook.NextAttemptAt.After(dueBy)) ||
			(hook.LeaseExpiresAt != nil && hook.LeaseExpiresAt.After(now)) {
			continue
		}
		hook.LeaseHolder, hook.LeaseExpiresAt = &holder, &leaseUntil
		cp := *hook
		out = append(out, &cp)
	}
	return out, nil
}

func (f *fakeWebhookSource) WebhookEventTypes(_ context.Context, projectID string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.filterReads++
	if f.filtersErr != nil {
		return nil, f.filtersErr
	}
	var eventTypes []string
	for _, hook := range f.hooks {
		if hook.Enabled && hook.ProjectID == projectID {
			eventTypes = append(eventTypes, hook.EventTypes...)
		}
	}
	return eventTypes, nil
}

// leasesOf returns the projects the leases so far named, "" for every
// project's.
func (f *fakeWebhookSource) leasesOf() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.leases...)
}

func (f *fakeWebhookSource) WebhookEventsVisible(_ context.Context, projectID string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return !f.hidden[projectID], nil
}

func (f *fakeWebhookSource) ListEventsAfterCursor(_ context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) ([]*domain.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*domain.Event
	for _, ev := range f.events[projectID] {
		if ev.CreatedAt.After(afterCreatedAt) || (ev.CreatedAt.Equal(afterCreatedAt) && ev.ID > afterID) {
			out = append(out, ev)
		}
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

func (f *fakeWebhookSource) WebhookSecrets(context.Context, *domain.Webhook, time.Time) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.secrets, f.secretsErr
}

// leased returns the stored webhook if holder holds its lease. The caller
// holds f.mu.
func (f *fakeWebhookSource) leased(hook *domain.Webhook, holder string) (*domain.Webhook, error) {
	stored, ok := f.hooks[hook.ID]
	if !ok || stored.LeaseHolder == nil || *stored.LeaseHolder != holder {
		return nil, database.NewNoRowFoundError(nil)
	}
	return stored, nil
}

func (f *fakeWebhookSource) RecordWebhookProgress(_ context.Context, hook *domain.Webhook, holder string, deliveredAt *time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.loseLeaseOnProgress {
		f.hooks[hook.ID].LeaseHolder = nil
	}
	stored, err := f.leased(hook, holder)
	if err != nil {
		return err
	}
	f.progress++
	stored.CursorCreatedAt, stored.CursorEventID = hook.CursorCreatedAt, hook.CursorEventID
	if deliveredAt != nil {
		stored.LastDeliveredAt, stored.FailingSince = deliveredAt, nil
	}
	return nil
}

func (f *fakeWebhookSource) RecordWebhookFailure(_ context.Context, hook *domain.Webhook, holder string, at time.Time, status *int32, nextAttemptAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	stored, err := f.leased(hook, holder)
	if err != nil {
		return err
	}
	stored.LastErrorAt, stored.LastErrorStatus, stored.NextAttemptAt = &at, status, &nextAttemptAt
	if stored.FailingSince == nil {
		stored.FailingSince = &at
	}
	stored.LeaseHolder, stored.LeaseExpiresAt = nil, nil
	return nil
}

func (f *fakeWebhookSource) DisableWebhook(_ context.Context, hook *domain.Webhook, holder string, at time.Time, status *int32, reason domain.WebhookDisabledReason) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	stored, err := f.leased(hook, holder)
	if err != nil {
		return err
	}
	stored.Enabled = false
	stored.LastErrorAt, stored.LastErrorStatus = &at, status
	stored.LeaseHolder, stored.LeaseExpiresAt = nil, nil
	f.disabled = append(f.disabled, fakeDisable{hookID: hook.ID, status: status, reason: reason})
	return nil
}

func (f *fakeWebhookSource) ReleaseWebhookLease(_ context.Context, hook *domain.Webhook, holder string, nextAttemptAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	stored, err := f.leased(hook, holder)
	if err != nil {
		return err
	}
	stored.NextAttemptAt = &nextAttemptAt
	stored.LeaseHolder, stored.LeaseExpiresAt = nil, nil
	f.released = append(f.released, hook.ID)
	return nil
}

// receivedDelivery is one request a test endpoint got.
type receivedDelivery struct {
	path   string
	header http.Header
	body   []byte
}

// webhookEndpoint is a customer's endpoint: an https test server that keeps
// what it receives and answers as respond says, 204 without one.
type webhookEndpoint struct {
	*httptest.Server
	mu       sync.Mutex
	received []receivedDelivery
	respond  func(eventID string) int
}

func newWebhookEndpoint(t *testing.T) *webhookEndpoint {
	t.Helper()
	e := &webhookEndpoint{}
	e.Server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		e.mu.Lock()
		e.received = append(e.received, receivedDelivery{path: r.URL.Path, header: r.Header.Clone(), body: body})
		respond := e.respond
		e.mu.Unlock()
		status := http.StatusNoContent
		if respond != nil {
			status = respond(r.Header.Get(webhookIDHeader))
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(e.Close)
	return e
}

func (e *webhookEndpoint) deliveries() []receivedDelivery {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]receivedDelivery(nil), e.received...)
}

// eventIDs are the webhook-id headers received, in order.
func (e *webhookEndpoint) eventIDs() []string {
	var ids []string
	for _, d := range e.deliveries() {
		ids = append(ids, d.header.Get(webhookIDHeader))
	}
	return ids
}

func (e *webhookEndpoint) answer(respond func(eventID string) int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.respond = respond
}

var webhookT0 = time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)

func testWebhook(id, projectID, url string, eventTypes ...string) *domain.Webhook {
	if len(eventTypes) == 0 {
		eventTypes = []string{domain.WebhookAllEventTypes}
	}
	return &domain.Webhook{
		ID: id, ProjectID: projectID, URL: url, EventTypes: eventTypes, Enabled: true,
		Secret: "ciphertext", CursorCreatedAt: webhookT0,
	}
}

// testEvents are events of the project, a second apart after webhookT0.
func testEvents(projectID string, eventTypes ...domain.EventType) []*domain.Event {
	evs := make([]*domain.Event, len(eventTypes))
	for i, eventType := range eventTypes {
		evs[i] = &domain.Event{
			ProjectID: projectID,
			ID:        "evt_" + strconv.Itoa(i+1),
			EventType: eventType,
			Category:  domain.EventCategoryEntity,
			CreatedAt: webhookT0.Add(time.Duration(i+1) * time.Second),
			Payload:   []byte(`{}`),
		}
	}
	return evs
}

func newTestWebhookShipper(src WebhookSource, client *http.Client, clock *fakeClock) *WebhookShipper {
	s := NewWebhookShipper(src, client, WebhookConfig{Enabled: true, Interval: time.Hour})
	s.now = clock.Now
	return s
}

// verifyStandardWebhook checks a delivery as a receiver does by hand: one of
// the header's signatures is the HMAC-SHA256 of id.timestamp.body under the
// secret's key.
func verifyStandardWebhook(secret string, d receivedDelivery) bool {
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(d.header.Get("webhook-id") + "." + d.header.Get("webhook-timestamp") + "."))
	mac.Write(d.body)
	want := mac.Sum(nil)
	for signature := range strings.FieldsSeq(d.header.Get("webhook-signature")) {
		version, encoded, _ := strings.Cut(signature, ",")
		got, err := base64.StdEncoding.DecodeString(encoded)
		if version == "v1" && err == nil && hmac.Equal(got, want) {
			return true
		}
	}
	return false
}

// A delivery is the event in the webhook body (webhookEvent), with the
// Standard Webhooks headers; the timestamp is the attempt's, not the event's
// (ADR 088 §2).
func TestWebhookShipper_DeliversTheEventSigned(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	hook := testWebhook("hook_1", "proj_a", endpoint.URL+"/hooks/zitadel")
	src := newFakeWebhookSource(hook)
	evs := testEvents("proj_a", domain.EventTypeUserCreated)
	src.addEvents("proj_a", evs...)
	clock := &fakeClock{t: webhookT0.Add(time.Hour)}
	delivered := metricstest.GrewOnly(t, metricsReader, metrics.WebhookDeliveries, nil, metrics.ResultKey, metrics.WebhookDelivered, metrics.WebhookFailed)

	n, err := newTestWebhookShipper(src, endpoint.Client(), clock).runOnce(t.Context(), "")
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	got := endpoint.deliveries()
	require.Len(t, got, 1)
	want, err := marshalWebhookEvent(evs[0])
	require.NoError(t, err)
	assert.Equal(t, string(want), string(got[0].body))
	assert.Equal(t, "application/json", got[0].header.Get("Content-Type"))
	assert.Equal(t, "evt_1", got[0].header.Get("webhook-id"))
	assert.Equal(t, strconv.FormatInt(clock.Now().Unix(), 10), got[0].header.Get("webhook-timestamp"))
	assert.True(t, verifyStandardWebhook(testWebhookSecret, got[0]), "signature %q", got[0].header.Get("webhook-signature"))
	assert.False(t, verifyStandardWebhook(testWebhookOldSecret, got[0]))
	for _, ambient := range []string{"Authorization", "Cookie", "Proxy-Authorization"} {
		assert.Empty(t, got[0].header.Get(ambient), ambient)
	}

	stored := src.get("hook_1")
	assert.Equal(t, "evt_1", stored.CursorEventID)
	assert.Equal(t, new(clock.Now()), stored.LastDeliveredAt)
	assert.Nil(t, stored.LeaseHolder, "the lease is given back")
	delivered(metrics.WebhookDelivered)
}

// While a rotation's previous secret is valid a delivery verifies under
// either secret (ADR 088 §3).
func TestWebhookShipper_SignsWithBothSecretsDuringARotation(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
	src.secrets = []string{testWebhookSecret, testWebhookOldSecret}
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)

	_, err := newTestWebhookShipper(src, endpoint.Client(), &fakeClock{t: webhookT0}).runOnce(t.Context(), "")
	require.NoError(t, err)

	got := endpoint.deliveries()
	require.Len(t, got, 1)
	assert.Len(t, strings.Fields(got[0].header.Get("webhook-signature")), 2)
	assert.True(t, verifyStandardWebhook(testWebhookSecret, got[0]))
	assert.True(t, verifyStandardWebhook(testWebhookOldSecret, got[0]))
}

// A secret that cannot be read, or that is not a secret, fails the delivery.
// Nothing is sent unsigned (ADR 088 §3).
func TestWebhookShipper_SendsNothingWithoutASecret(t *testing.T) {
	for name, set := range map[string]func(*fakeWebhookSource){
		"cannot be decrypted": func(f *fakeWebhookSource) {
			f.secrets, f.secretsErr = nil, errors.New("cipher: message authentication failed")
		},
		"is not a secret": func(f *fakeWebhookSource) { f.secrets = []string{"ciphertext"} },
		"is missing":      func(f *fakeWebhookSource) { f.secrets = []string{} },
	} {
		t.Run(name, func(t *testing.T) {
			endpoint := newWebhookEndpoint(t)
			src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
			set(src)
			src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
			clock := &fakeClock{t: webhookT0}

			_, err := newTestWebhookShipper(src, endpoint.Client(), clock).runOnce(t.Context(), "")
			require.NoError(t, err)

			assert.Empty(t, endpoint.deliveries())
			stored := src.get("hook_1")
			assert.Equal(t, new(clock.Now()), stored.LastErrorAt)
			assert.Nil(t, stored.LastErrorStatus)
			assert.Empty(t, stored.CursorEventID)
		})
	}
}

// The filter skips an event, and the cursor moves past it, also when nothing
// after it is delivered (ADR 088 §4).
func TestWebhookShipper_FilterSkipsAndTheCursorMovesOn(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	listed := testWebhook("hook_listed", "proj_a", endpoint.URL+"/listed", "user.created", "user.deleted")
	all := testWebhook("hook_all", "proj_a", endpoint.URL+"/all")
	none := testWebhook("hook_none", "proj_a", endpoint.URL+"/none", "team.created")
	src := newFakeWebhookSource(listed, all, none)
	src.addEvents("proj_a", testEvents("proj_a",
		domain.EventTypeUserCreated, // evt_1
		domain.EventTypeRequestAPI,  // evt_2
		domain.EventTypeUserUpdated, // evt_3
		domain.EventTypeUserDeleted, // evt_4
		domain.EventTypeRequestAPI,  // evt_5
	)...)

	_, err := newTestWebhookShipper(src, endpoint.Client(), &fakeClock{t: webhookT0}).runOnce(t.Context(), "")
	require.NoError(t, err)

	sent := map[string][]string{}
	for _, d := range endpoint.deliveries() {
		sent[d.path] = append(sent[d.path], d.header.Get("webhook-id"))
	}
	assert.Equal(t, map[string][]string{
		"/listed": {"evt_1", "evt_4"},
		"/all":    {"evt_1", "evt_3", "evt_4"},
	}, sent, "* is every type but request.api; a list is its types; a type nobody wrote matches nothing")
	for _, hook := range []string{"hook_listed", "hook_all", "hook_none"} {
		assert.Equal(t, "evt_5", src.get(hook).CursorEventID, "%s: the cursor is past the events the filter skipped", hook)
	}
	assert.Nil(t, src.get("hook_none").LastDeliveredAt, "nothing was delivered")
	assert.NotNil(t, src.get("hook_listed").LastDeliveredAt)
}

// Delivery is in order, and a failure holds back the events after it: the
// cursor stays on the last one delivered (ADR 088 §4).
func TestWebhookShipper_HeadOfLineStopsAtAFailure(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	endpoint.answer(func(eventID string) int {
		if eventID == "evt_2" {
			return http.StatusServiceUnavailable
		}
		return http.StatusOK
	})
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated, domain.EventTypeUserUpdated, domain.EventTypeUserDeleted)...)
	clock := &fakeClock{t: webhookT0.Add(time.Minute)}
	shipper := newTestWebhookShipper(src, endpoint.Client(), clock)
	failed := metricstest.GrewOnly(t, metricsReader, metrics.WebhookDeliveries, nil, metrics.ResultKey, metrics.WebhookFailed)

	_, err := shipper.runOnce(t.Context(), "")
	require.NoError(t, err)

	assert.Equal(t, []string{"evt_1", "evt_2"}, endpoint.eventIDs(), "evt_3 waits behind evt_2")
	failed(metrics.WebhookFailed)
	stored := src.get("hook_1")
	assert.Equal(t, "evt_1", stored.CursorEventID)
	assert.Equal(t, new(clock.Now()), stored.LastDeliveredAt)
	assert.Equal(t, new(clock.Now()), stored.LastErrorAt)
	assert.Equal(t, new(int32(503)), stored.LastErrorStatus)
	assert.Equal(t, new(clock.Now()), stored.FailingSince, "failing from this failure: evt_1 succeeded before it")
	assert.Equal(t, new(clock.Now().Add(5*time.Second)), stored.NextAttemptAt)
	assert.Nil(t, stored.LeaseHolder)
	assert.Empty(t, src.released, "the failure gave the lease back with what it recorded")

	// Not due inside the backoff; then the same event again, under the same
	// id, and on from there.
	clock.Set(clock.Now().Add(4 * time.Second))
	n, err := shipper.runOnce(t.Context(), "")
	require.NoError(t, err)
	assert.Zero(t, n)
	endpoint.answer(nil)
	clock.Set(clock.Now().Add(time.Second))
	_, err = shipper.runOnce(t.Context(), "")
	require.NoError(t, err)
	assert.Equal(t, []string{"evt_1", "evt_2", "evt_2", "evt_3"}, endpoint.eventIDs())
	stored = src.get("hook_1")
	assert.Equal(t, "evt_3", stored.CursorEventID)
	assert.Nil(t, stored.FailingSince, "a success ends the failing state")
}

// An endpoint that keeps failing is retried after 5 seconds, then twice as
// long each time, up to an hour; a success starts the schedule over
// (ADR 088 §4).
func TestWebhookShipper_BacksOffAndASuccessResets(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	endpoint.answer(func(string) int { return http.StatusInternalServerError })
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated, domain.EventTypeUserUpdated)...)
	clock := &fakeClock{t: webhookT0.Add(time.Minute)}
	shipper := newTestWebhookShipper(src, endpoint.Client(), clock)

	attempt := func() time.Duration {
		t.Helper()
		_, err := shipper.runOnce(t.Context(), "")
		require.NoError(t, err)
		stored := src.get("hook_1")
		require.NotNil(t, stored.NextAttemptAt)
		wait := stored.NextAttemptAt.Sub(clock.Now())
		clock.Set(*stored.NextAttemptAt)
		return wait
	}
	var waits []time.Duration
	for range 12 {
		waits = append(waits, attempt())
	}
	assert.Equal(t, []time.Duration{
		5 * time.Second, 10 * time.Second, 20 * time.Second, 40 * time.Second, 80 * time.Second,
		160 * time.Second, 320 * time.Second, 640 * time.Second, 1280 * time.Second, 2560 * time.Second,
		time.Hour, time.Hour,
	}, waits)
	assert.Len(t, endpoint.deliveries(), 12, "one attempt per round")

	// evt_1 goes through and evt_2 fails: the wait is 5 seconds again.
	endpoint.answer(func(eventID string) int {
		if eventID == "evt_1" {
			return http.StatusOK
		}
		return http.StatusInternalServerError
	})
	assert.Equal(t, 5*time.Second, attempt())
}

// A webhook that answers 410, or that has failed for 3 days without a
// success, is disabled with its webhook.disabled event (ADR 088 §4).
func TestWebhookShipper_GivesUp(t *testing.T) {
	for _, tc := range []struct {
		name       string
		status     int
		failingFor time.Duration // zero: not failing before
		want       *fakeDisable
	}{
		{"410 at the first failure", http.StatusGone, 0,
			&fakeDisable{hookID: "hook_1", status: new(int32(410)), reason: domain.WebhookDisabledReasonGone}},
		{"failing for 3 days", http.StatusInternalServerError, 3 * 24 * time.Hour,
			&fakeDisable{hookID: "hook_1", status: new(int32(500)), reason: domain.WebhookDisabledReasonFailing}},
		{"failing for a minute less", http.StatusInternalServerError, 3*24*time.Hour - time.Minute, nil},
		{"404 is not gone", http.StatusNotFound, 0, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			endpoint := newWebhookEndpoint(t)
			endpoint.answer(func(string) int { return tc.status })
			clock := &fakeClock{t: webhookT0.Add(96 * time.Hour)}
			hook := testWebhook("hook_1", "proj_a", endpoint.URL)
			if tc.failingFor > 0 {
				hook.FailingSince = new(clock.Now().Add(-tc.failingFor))
			}
			src := newFakeWebhookSource(hook)
			src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
			shipper := newTestWebhookShipper(src, endpoint.Client(), clock)

			_, err := shipper.runOnce(t.Context(), "")
			require.NoError(t, err)

			stored := src.get("hook_1")
			if tc.want == nil {
				assert.Empty(t, src.disabled)
				assert.True(t, stored.Enabled)
				assert.NotNil(t, stored.NextAttemptAt)
				return
			}
			assert.Equal(t, []fakeDisable{*tc.want}, src.disabled)
			assert.False(t, stored.Enabled)
			assert.Empty(t, stored.CursorEventID)

			// Disabled, it is sent nothing more.
			clock.Set(clock.Now().Add(24 * time.Hour))
			n, err := shipper.runOnce(t.Context(), "")
			require.NoError(t, err)
			assert.Zero(t, n)
			assert.Len(t, endpoint.deliveries(), 1)
		})
	}
}

// One sender (ADR 088 §4): servers that run at the same time deliver each
// event once between them.
func TestWebhookShipper_TwoServersDeliverEachEventOnce(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	var hooks []*domain.Webhook
	for i := range 6 {
		hooks = append(hooks, testWebhook("hook_"+strconv.Itoa(i), "proj_a", endpoint.URL+"/"+strconv.Itoa(i)))
	}
	src := newFakeWebhookSource(hooks...)
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated, domain.EventTypeUserUpdated, domain.EventTypeUserDeleted)...)
	clock := &fakeClock{t: webhookT0.Add(time.Minute)}
	a := newTestWebhookShipper(src, endpoint.Client(), clock)
	b := newTestWebhookShipper(src, endpoint.Client(), clock)
	require.NotEqual(t, a.holder, b.holder)

	var wg sync.WaitGroup
	for _, shipper := range []*WebhookShipper{a, b, a, b} {
		wg.Go(func() {
			_, err := shipper.runOnce(context.Background(), "")
			assert.NoError(t, err)
		})
	}
	wg.Wait()

	assert.Len(t, endpoint.deliveries(), len(hooks)*3, "each webhook got each event once")
	for _, hook := range hooks {
		assert.Equal(t, "evt_3", src.get(hook.ID).CursorEventID)
	}
}

// A delivery whose lease was lost under it, to another server or because
// the webhook was enabled anew, stops and gives nothing back.
func TestWebhookShipper_StopsWhenTheLeaseIsLost(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
	src.loseLeaseOnProgress = true
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)

	_, err := newTestWebhookShipper(src, endpoint.Client(), &fakeClock{t: webhookT0}).runOnce(t.Context(), "")
	require.NoError(t, err)

	assert.Zero(t, src.progress)
	assert.Empty(t, src.released)
	assert.Empty(t, src.get("hook_1").CursorEventID)
}

// Before the claim a project's webhook delivers nothing, and keeps what is
// pending for after it (ADR 049 §4, ADR 088 §4).
func TestWebhookShipper_SkipsAProjectThePreClaimGateHides(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_unclaimed", endpoint.URL))
	src.hidden["proj_unclaimed"] = true
	src.addEvents("proj_unclaimed", testEvents("proj_unclaimed", domain.EventTypeProjectCreated)...)
	clock := &fakeClock{t: webhookT0.Add(time.Minute)}
	shipper := newTestWebhookShipper(src, endpoint.Client(), clock)

	_, err := shipper.runOnce(t.Context(), "")
	require.NoError(t, err)
	assert.Empty(t, endpoint.deliveries())
	stored := src.get("hook_1")
	assert.Empty(t, stored.CursorEventID)
	assert.Nil(t, stored.LastErrorAt, "hidden is not failing")
	assert.Equal(t, []string{"hook_1"}, src.released)

	src.mu.Lock()
	src.hidden["proj_unclaimed"] = false
	src.mu.Unlock()
	clock.Set(clock.Now().Add(time.Second))
	_, err = shipper.runOnce(t.Context(), "")
	require.NoError(t, err)
	assert.Equal(t, []string{"evt_1"}, endpoint.eventIDs())
}

// webhookEgressClient is the hardened client as cmd/server builds it for
// deliveries, with the loopback addresses of test servers let through the
// deny list the way an operator lets a development host through.
func webhookEgressClient(t *testing.T, allow ...string) *http.Client {
	t.Helper()
	client, err := WebhookClientConfig(httputil.ClientConfig{
		DenyList:  httputil.DefaultDenyList,
		AllowList: allow,
		// What the schema client may do must not leak into deliveries.
		MaxRedirects: 5, AllowHTTPSDowngrade: true, MaxBodySize: 1, Timeout: time.Hour,
	}).NewClient()
	require.NoError(t, err)
	return client
}

func TestWebhookClientConfig(t *testing.T) {
	cfg := WebhookClientConfig(httputil.ClientConfig{
		DenyList: []string{"10.0.0.0/8"}, AllowList: []string{"10.1.2.3"},
		MaxRedirects: 5, AllowHTTPSDowngrade: true, MaxBodySize: 1 << 20, Timeout: time.Minute,
	})
	assert.Equal(t, httputil.ClientConfig{
		Timeout:   10 * time.Second,
		DenyList:  []string{"10.0.0.0/8"},
		AllowList: []string{"10.1.2.3"},
	}, cfg, "the deployment's address policy, no redirect, the delivery deadline")
}

// The egress client follows no redirect, whatever the status: the request
// that would follow is never made.
func TestWebhookEgressClient_FollowsNoRedirect(t *testing.T) {
	for _, status := range []int{http.StatusMovedPermanently, http.StatusFound, http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			var followed int
			var mu sync.Mutex
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/elsewhere" {
					mu.Lock()
					followed++
					mu.Unlock()
					return
				}
				http.Redirect(w, r, "/elsewhere", status)
			}))
			t.Cleanup(srv.Close)

			resp, err := webhookEgressClient(t, "127.0.0.0/8").Post(srv.URL, "application/json", strings.NewReader("{}"))
			require.ErrorIs(t, err, httputil.ErrTooManyRedirects)
			require.NotNil(t, resp)
			assert.Equal(t, status, resp.StatusCode)
			mu.Lock()
			defer mu.Unlock()
			assert.Zero(t, followed)
		})
	}
}

// A redirect is a failed delivery with the status the endpoint answered,
// not followed (ADR 088 §4). The endpoint is https, so the test server's
// client makes the request, under the egress client's own redirect policy.
func TestWebhookShipper_ARedirectIsAFailure(t *testing.T) {
	var followed int
	var mu sync.Mutex
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/elsewhere" {
			mu.Lock()
			followed++
			mu.Unlock()
			return
		}
		http.Redirect(w, r, "/elsewhere", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(srv.Close)
	client := srv.Client()
	client.CheckRedirect = webhookEgressClient(t).CheckRedirect
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", srv.URL+"/hooks"))
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)

	_, err := newTestWebhookShipper(src, client, &fakeClock{t: webhookT0}).runOnce(t.Context(), "")
	require.NoError(t, err)

	mu.Lock()
	defer mu.Unlock()
	assert.Zero(t, followed)
	stored := src.get("hook_1")
	assert.Equal(t, new(int32(307)), stored.LastErrorStatus)
	assert.Empty(t, stored.CursorEventID)
}

// A stored URL that is not https, or that carries userinfo, is sent nothing,
// through the egress client that would reach it: the API refuses such a URL,
// so the row is not one it wrote.
func TestWebhookShipper_SendsOnlyToHTTPSWithoutUserinfo(t *testing.T) {
	var hits int
	var mu sync.Mutex
	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
	})
	plain := httptest.NewServer(handler)
	t.Cleanup(plain.Close)
	secure := httptest.NewTLSServer(handler)
	t.Cleanup(secure.Close)

	for name, target := range map[string]string{
		"http":     plain.URL,
		"userinfo": strings.Replace(secure.URL, "https://", "https://user:pass@", 1),
		"no url":   "://",
	} {
		t.Run(name, func(t *testing.T) {
			src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", target))
			src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
			clock := &fakeClock{t: webhookT0}

			_, err := newTestWebhookShipper(src, webhookEgressClient(t, "127.0.0.0/8"), clock).runOnce(t.Context(), "")
			require.NoError(t, err)

			mu.Lock()
			defer mu.Unlock()
			assert.Zero(t, hits)
			stored := src.get("hook_1")
			assert.Equal(t, new(clock.Now()), stored.LastErrorAt)
			assert.Nil(t, stored.LastErrorStatus)
		})
	}
}

// A webhook that names an address the egress policy denies, loopback here,
// fails without a connection (ADR 061).
func TestWebhookShipper_TheEgressPolicyDeniesAnInternalAddress(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)

	_, err := newTestWebhookShipper(src, webhookEgressClient(t), &fakeClock{t: webhookT0}).runOnce(t.Context(), "")
	require.NoError(t, err)

	assert.Empty(t, endpoint.deliveries())
	stored := src.get("hook_1")
	assert.NotNil(t, stored.LastErrorAt)
	assert.Nil(t, stored.LastErrorStatus)
}

// A slow endpoint delays only itself: the loop starts a round without
// waiting for the deliveries of the one before (ADR 088 §4).
func TestWebhookShipper_ASlowEndpointDelaysOnlyItself(t *testing.T) {
	unblock := make(chan struct{})
	slow := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-unblock }))
	t.Cleanup(slow.Close)
	fast := newWebhookEndpoint(t)
	// One client for both servers: the test certificate is the same.
	src := newFakeWebhookSource(
		testWebhook("hook_slow", "proj_slow", slow.URL),
		testWebhook("hook_fast", "proj_fast", fast.URL),
	)
	src.addEvents("proj_slow", testEvents("proj_slow", domain.EventTypeUserCreated)...)
	src.addEvents("proj_fast", testEvents("proj_fast", domain.EventTypeUserCreated)...)
	clock := &fakeClock{t: webhookT0.Add(time.Minute)}
	shipper := newTestWebhookShipper(src, fast.Client(), clock)

	var running sync.WaitGroup
	_, err := shipper.dispatch(t.Context(), "", &running)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return len(fast.deliveries()) == 1 && src.get("hook_fast").LeaseHolder == nil },
		5*time.Second, 5*time.Millisecond)

	// The next round, while the slow endpoint still holds its request.
	more := testEvents("proj_fast", domain.EventTypeUserCreated, domain.EventTypeUserUpdated)[1:]
	src.addEvents("proj_fast", more...)
	clock.Set(clock.Now().Add(5 * time.Second))
	_, err = shipper.dispatch(t.Context(), "", &running)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return len(fast.deliveries()) == 2 }, 5*time.Second, 5*time.Millisecond)
	assert.NotNil(t, src.get("hook_slow").LeaseHolder, "the slow webhook is still held, so no round takes it twice")

	close(unblock)
	running.Wait()
	assert.Equal(t, "evt_1", src.get("hook_slow").CursorEventID)
}

func newWebhookTrigger(t *testing.T, src WebhookSource, client *http.Client) http.Handler {
	t.Helper()
	trigger := NewWebhookShipper(src, client, WebhookConfig{Enabled: true, TriggerSecret: testTriggerSecret}).Trigger()
	require.NotNil(t, trigger)
	return trigger
}

func TestWebhookConfig_Validate(t *testing.T) {
	require.NoError(t, WebhookConfig{}.Validate())
	require.NoError(t, WebhookConfig{TriggerSecret: testTriggerSecret}.Validate())
	err := WebhookConfig{TriggerSecret: "short"}.Validate()
	assert.ErrorContains(t, err, "events.webhooks.trigger_secret must be at least 16 printable ASCII characters")
}

func TestWebhookShipper_TriggerOnlyWithASecretAndDeliveryOn(t *testing.T) {
	src := newFakeWebhookSource()
	assert.Nil(t, NewWebhookShipper(src, http.DefaultClient, WebhookConfig{Enabled: true}).Trigger(), "the timer delivers")
	assert.Nil(t, NewWebhookShipper(src, http.DefaultClient, WebhookConfig{TriggerSecret: testTriggerSecret}).Trigger(), "delivery is off")
	assert.NotNil(t, NewWebhookShipper(src, http.DefaultClient, WebhookConfig{Enabled: true, TriggerSecret: testTriggerSecret}).Trigger())
}

// With a trigger the server keeps no timer, as the retention job keeps none.
func TestWebhookShipper_StartRunsTheLoopOnlyWithoutATrigger(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	for name, tc := range map[string]struct {
		cfg   WebhookConfig
		loops bool
	}{
		"timer":   {WebhookConfig{Enabled: true, Interval: 5 * time.Millisecond}, true},
		"trigger": {WebhookConfig{Enabled: true, Interval: 5 * time.Millisecond, TriggerSecret: testTriggerSecret}, false},
		"off":     {WebhookConfig{Interval: 5 * time.Millisecond}, false},
	} {
		t.Run(name, func(t *testing.T) {
			src := newFakeWebhookSource(testWebhook("hook_"+name, "proj_a", endpoint.URL))
			src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
			shipper := NewWebhookShipper(src, endpoint.Client(), tc.cfg)
			shipper.Start()
			defer shipper.Close()

			delivered := func() bool { return src.get("hook_"+name).CursorEventID == "evt_1" }
			if tc.loops {
				require.Eventually(t, delivered, 5*time.Second, 5*time.Millisecond)
				return
			}
			time.Sleep(50 * time.Millisecond)
			assert.False(t, delivered())
		})
	}
}

func TestWebhookShipper_TriggerDeliversOncePerRequest(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			endpoint := newWebhookEndpoint(t)
			src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
			src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)

			rec := serveTrigger(newWebhookTrigger(t, src, endpoint.Client()), method, "Bearer "+testTriggerSecret)

			assert.Equal(t, http.StatusOK, rec.Code)
			assert.JSONEq(t, `{"webhooks":1}`, rec.Body.String())
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			assert.Equal(t, []string{"evt_1"}, endpoint.eventIDs(), "delivered before the answer")
		})
	}
}

func TestWebhookShipper_TriggerRefusesARequestWithoutTheSecret(t *testing.T) {
	for name, authorization := range map[string]string{
		"no credentials":            "",
		"another secret":            "Bearer 0123456789abcdef-another",
		"the secret, cut short":     "Bearer " + testTriggerSecret[:len(testTriggerSecret)-1],
		"the secret, and then some": "Bearer " + testTriggerSecret + "x",
		"another scheme":            "Basic " + testTriggerSecret,
		"the secret alone":          testTriggerSecret,
	} {
		t.Run(name, func(t *testing.T) {
			endpoint := newWebhookEndpoint(t)
			src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
			src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)

			rec := serveTrigger(newWebhookTrigger(t, src, endpoint.Client()), http.MethodGet, authorization)

			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, "Bearer", rec.Header().Get("WWW-Authenticate"))
			assert.Empty(t, endpoint.deliveries())
		})
	}
}

func TestWebhookShipper_TriggerAnswersOnlyGetAndPost(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodDelete, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			rec := serveTrigger(newWebhookTrigger(t, newFakeWebhookSource(), http.DefaultClient), method, "Bearer "+testTriggerSecret)

			assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
			assert.Equal(t, "GET, POST", rec.Header().Get("Allow"))
		})
	}
}

// An endpoint that fails is not a failed round; a server that cannot read
// its webhooks is, and the scheduler's log shows it.
func TestWebhookShipper_TriggerAnswers500OnlyForTheServersOwnFault(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	endpoint.answer(func(string) int { return http.StatusInternalServerError })
	src := newFakeWebhookSource(testWebhook("hook_1", "proj_a", endpoint.URL))
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
	rec := serveTrigger(newWebhookTrigger(t, src, endpoint.Client()), http.MethodGet, "Bearer "+testTriggerSecret)
	assert.Equal(t, http.StatusOK, rec.Code)

	src.leaseErr = errors.New("failed to connect")
	rec = serveTrigger(newWebhookTrigger(t, src, endpoint.Client()), http.MethodGet, "Bearer "+testTriggerSecret)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Equal(t, "webhook delivery: round failed\n", rec.Body.String(), "the cause stays in the server's log")
}
