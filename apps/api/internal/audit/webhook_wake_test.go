package audit

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

const testWakeSecret = "0123456789abcdef-wake"

func TestWebhookConfig_ValidateWake(t *testing.T) {
	wake := WebhookWakeConfig{URL: "https://wake.example/hook", Secret: testWakeSecret}
	require.NoError(t, WebhookConfig{TriggerSecret: testTriggerSecret, Wake: wake}.Validate())

	for name, tc := range map[string]struct {
		cfg  WebhookConfig
		want string
	}{
		"without a trigger":      {WebhookConfig{Wake: wake}, "events.webhooks.wake.url needs events.webhooks.trigger_secret"},
		"a secret alone":         {WebhookConfig{Wake: WebhookWakeConfig{Secret: testWakeSecret}}, "events.webhooks.wake.secret is set without events.webhooks.wake.url"},
		"no secret":              {WebhookConfig{TriggerSecret: testTriggerSecret, Wake: WebhookWakeConfig{URL: wake.URL}}, "events.webhooks.wake.secret must be at least 16 printable ASCII characters"},
		"http":                   {WebhookConfig{TriggerSecret: testTriggerSecret, Wake: WebhookWakeConfig{URL: "http://wake.example/hook", Secret: testWakeSecret}}, "events.webhooks.wake.url must be an https URL without userinfo"},
		"userinfo":               {WebhookConfig{TriggerSecret: testTriggerSecret, Wake: WebhookWakeConfig{URL: "https://user:pass@wake.example/hook", Secret: testWakeSecret}}, "events.webhooks.wake.url must be an https URL without userinfo"},
		"not a URL":              {WebhookConfig{TriggerSecret: testTriggerSecret, Wake: WebhookWakeConfig{URL: "wake", Secret: testWakeSecret}}, "events.webhooks.wake.url must be an https URL without userinfo"},
		"the url is not echoed":  {WebhookConfig{TriggerSecret: testTriggerSecret, Wake: WebhookWakeConfig{URL: "http://wake.example/hook?token=s3cret", Secret: testWakeSecret}}, "events.webhooks.wake.url must be an https URL without userinfo"},
		"a short trigger secret": {WebhookConfig{TriggerSecret: "short", Wake: wake}, "events.webhooks.trigger_secret must be at least"},
	} {
		t.Run(name, func(t *testing.T) {
			err := tc.cfg.Validate()
			require.ErrorContains(t, err, tc.want)
			assert.NotContains(t, err.Error(), "s3cret")
		})
	}
}

// wakeHook is the operator's endpoint behind events.webhooks.wake.url: an
// https test server that keeps the calls it gets and answers as respond says,
// 202 without one.
type wakeHook struct {
	*httptest.Server
	mu      sync.Mutex
	calls   []webhookWakeCall
	auth    []string
	respond func(w http.ResponseWriter)
}

func newWakeHook(t *testing.T) *wakeHook {
	t.Helper()
	h := &wakeHook{}
	h.Server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var call webhookWakeCall
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" || json.Unmarshal(body, &call) != nil {
			http.Error(w, "not a wake call", http.StatusBadRequest)
			return
		}
		h.mu.Lock()
		h.calls = append(h.calls, call)
		h.auth = append(h.auth, r.Header.Get("Authorization"))
		respond := h.respond
		h.mu.Unlock()
		if respond != nil {
			respond(w)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(h.Close)
	return h
}

func (h *wakeHook) received() []webhookWakeCall {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]webhookWakeCall(nil), h.calls...)
}

func (h *wakeHook) answer(respond func(w http.ResponseWriter)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.respond = respond
}

// newHookedWebhookShipper is the shipper of a server that keeps no timer:
// a trigger runs its rounds and the hook hears of its wake-ups.
func newHookedWebhookShipper(src WebhookSource, client *http.Client, hook *wakeHook, clock *fakeClock) *WebhookShipper {
	s := NewWebhookShipper(src, client, WebhookConfig{
		Enabled:       true,
		TriggerSecret: testTriggerSecret,
		Wake:          WebhookWakeConfig{URL: hook.URL + "/wake", Secret: testWakeSecret},
	})
	s.now = clock.Now
	s.wake.client = hook.Client()
	return s
}

// The point of the wake-up: an event is delivered when it is stored, not
// when the timer next looks.
func TestWebhookShipper_AWakeUpDeliversWithoutWaitingForTheTick(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	src := newFakeWebhookSource(
		testWebhook("hook_a", "proj_a", endpoint.URL),
		testWebhook("hook_b", "proj_b", endpoint.URL),
	)
	shipper := NewWebhookShipper(src, endpoint.Client(), WebhookConfig{Enabled: true, Interval: time.Hour})
	shipper.Start()
	defer shipper.Close()

	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
	src.addEvents("proj_b", testEvents("proj_b", domain.EventTypeUserCreated)...)
	shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})

	require.Eventually(t, func() bool { return src.get("hook_a").CursorEventID == "evt_1" }, 5*time.Second, 5*time.Millisecond)
	assert.Empty(t, src.get("hook_b").CursorEventID, "the round is the woken project's, not everyone's")
	for _, projectID := range src.leasesOf() {
		assert.Equal(t, "proj_a", projectID)
	}
}

// Many events in a moment are one round: one lease that finds the webhook
// and the one after it that finds no more.
func TestWebhookShipper_ABurstOfWakeUpsIsOneRound(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	src := newFakeWebhookSource(testWebhook("hook_a", "proj_a", endpoint.URL))
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated, domain.EventTypeUserUpdated)...)
	shipper := NewWebhookShipper(src, endpoint.Client(), WebhookConfig{Enabled: true, Interval: time.Hour})
	shipper.Start()
	defer shipper.Close()

	for range 200 {
		shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})
	}
	require.Eventually(t, func() bool { return src.get("hook_a").CursorEventID == "evt_2" }, 5*time.Second, 5*time.Millisecond)

	// A wake-up after the round waits for the next, which is no sooner than
	// webhookWakeEvery after the first.
	shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})
	time.Sleep(3 * webhookWakeDelay)
	assert.Equal(t, []string{"proj_a", "proj_a"}, src.leasesOf())
	assert.Equal(t, 1, src.filterReads, "the project's webhooks are read once and remembered")

	require.Eventually(t, func() bool { return len(src.leasesOf()) > 2 }, 5*time.Second, 5*time.Millisecond, "the later wake-up gets its round")
}

// A project with no webhook that takes the event costs no lease, and one
// read of its webhooks however often it is woken.
func TestWebhookShipper_AWakeUpNobodyWantsStartsNoRound(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	disabled := testWebhook("hook_off", "proj_off", endpoint.URL)
	disabled.Enabled = false
	src := newFakeWebhookSource(
		disabled,
		testWebhook("hook_users", "proj_users", endpoint.URL, string(domain.EventTypeUserCreated)),
		testWebhook("hook_all", "proj_all", endpoint.URL),
	)
	shipper := NewWebhookShipper(src, endpoint.Client(), WebhookConfig{Enabled: true, Interval: time.Hour})
	shipper.Start()
	defer shipper.Close()

	for range 50 {
		shipper.Wake(t.Context(), "proj_none", []domain.EventType{domain.EventTypeUserCreated})
		shipper.Wake(t.Context(), "proj_off", []domain.EventType{domain.EventTypeUserCreated})
		shipper.Wake(t.Context(), "proj_users", []domain.EventType{domain.EventTypeUserDeleted})
		// "*" stands for every type but request.api (ADR 088 §1).
		shipper.Wake(t.Context(), "proj_all", []domain.EventType{domain.EventTypeRequestAPI})
	}
	time.Sleep(5 * webhookWakeDelay)

	assert.Empty(t, src.leasesOf())
	src.mu.Lock()
	defer src.mu.Unlock()
	assert.Equal(t, 4, src.filterReads, "once per project")
}

// With a trigger and no hook, nothing in the server can start a round, so a
// wake-up costs nothing at all.
func TestWebhookShipper_AWakeUpWithATriggerAloneDoesNothing(t *testing.T) {
	src := newFakeWebhookSource(testWebhook("hook_a", "proj_a", "https://endpoint.example"))
	for name, cfg := range map[string]WebhookConfig{
		"trigger": {Enabled: true, TriggerSecret: testTriggerSecret},
		"off":     {Interval: time.Hour},
	} {
		t.Run(name, func(t *testing.T) {
			shipper := NewWebhookShipper(src, http.DefaultClient, cfg)
			shipper.Start()
			defer shipper.Close()
			shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})
			assert.Zero(t, src.filterReads)
			assert.Empty(t, src.leasesOf())
		})
	}
}

func TestWebhookShipper_AWakeUpCallsTheHook(t *testing.T) {
	hook := newWakeHook(t)
	src := newFakeWebhookSource(testWebhook("hook_a", "proj_a", "https://endpoint.example"))
	shipper := newHookedWebhookShipper(src, http.DefaultClient, hook, &fakeClock{t: webhookT0})

	shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})

	assert.Equal(t, []webhookWakeCall{{ProjectID: "proj_a"}}, hook.received(), "called before Wake returns: nothing runs after the request")
	assert.Equal(t, []string{"Bearer " + testWakeSecret}, hook.auth)
	assert.Empty(t, src.leasesOf(), "the hook's caller starts the round, through the trigger")
}

// The hook is not called once per sign-in of a project with no webhook: the
// server remembers which event types a project's webhooks take.
func TestWebhookShipper_TheHookHearsOnlyOfProjectsWithAWebhookThatTakesTheEvent(t *testing.T) {
	hook := newWakeHook(t)
	clock := &fakeClock{t: webhookT0}
	src := newFakeWebhookSource()
	shipper := newHookedWebhookShipper(src, http.DefaultClient, hook, clock)
	wake := func(eventTypes ...domain.EventType) { shipper.Wake(t.Context(), "proj_a", eventTypes) }

	for range 20 {
		wake(domain.EventTypeUserDeleted)
	}
	assert.Empty(t, hook.received())
	assert.Equal(t, 1, src.filterReads)

	// Another server created the webhook: this one learns of it when what
	// it remembers is webhookFiltersTTL old.
	src.mu.Lock()
	src.hooks["hook_a"] = testWebhook("hook_a", "proj_a", "https://endpoint.example", string(domain.EventTypeUserDeleted))
	src.mu.Unlock()
	wake(domain.EventTypeUserDeleted)
	assert.Empty(t, hook.received())
	clock.Set(webhookT0.Add(webhookFiltersTTL))
	wake(domain.EventTypeUserDeleted)
	assert.Len(t, hook.received(), 1)
	assert.Equal(t, 2, src.filterReads)

	// A type the webhook does not list is not worth a call.
	wake(domain.EventTypeUserCreated, domain.EventTypeRequestAPI)
	assert.Len(t, hook.received(), 1)
	wake(domain.EventTypeUserCreated, domain.EventTypeUserDeleted)
	assert.Len(t, hook.received(), 2)
	assert.Equal(t, 2, src.filterReads)
}

// The server that changed a project's webhooks reads them anew with that
// event, so a webhook is woken from the first event after it was created.
func TestWebhookShipper_AWebhookEventRefreshesWhatTheServerRemembers(t *testing.T) {
	hook := newWakeHook(t)
	src := newFakeWebhookSource()
	shipper := newHookedWebhookShipper(src, http.DefaultClient, hook, &fakeClock{t: webhookT0})

	shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})
	require.Empty(t, hook.received())

	src.mu.Lock()
	src.hooks["hook_a"] = testWebhook("hook_a", "proj_a", "https://endpoint.example", string(domain.EventTypeUserCreated))
	src.mu.Unlock()
	shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeWebhookCreated})
	assert.Empty(t, hook.received(), "webhook.created is not a type this webhook takes")
	shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})
	assert.Len(t, hook.received(), 1)
}

// A hook that fails or hangs never fails the request that stored the event,
// holds it for no longer than the client's deadline, and is left alone for
// webhookWakePause.
func TestWebhookShipper_AFailingHookIsBoundedAndPaused(t *testing.T) {
	for name, respond := range map[string]func(release <-chan struct{}) func(http.ResponseWriter){
		"answers 500": func(<-chan struct{}) func(http.ResponseWriter) {
			return func(w http.ResponseWriter) { w.WriteHeader(http.StatusInternalServerError) }
		},
		"does not answer": func(release <-chan struct{}) func(http.ResponseWriter) {
			return func(http.ResponseWriter) { <-release }
		},
	} {
		t.Run(name, func(t *testing.T) {
			hook := newWakeHook(t)
			release := make(chan struct{})
			defer close(release)
			hook.answer(respond(release))
			clock := &fakeClock{t: webhookT0}
			src := newFakeWebhookSource(testWebhook("hook_a", "proj_a", "https://endpoint.example"))
			shipper := newHookedWebhookShipper(src, http.DefaultClient, hook, clock)
			shipper.wake.client = &http.Client{Transport: hook.Client().Transport, Timeout: 100 * time.Millisecond}
			wake := func() { shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated}) }

			start := time.Now()
			wake()
			assert.Less(t, time.Since(start), webhookWakeTimeout)
			require.Len(t, hook.received(), 1)

			for range 10 {
				wake()
			}
			assert.Len(t, hook.received(), 1, "no call while paused")

			hook.answer(nil)
			clock.Set(webhookT0.Add(webhookWakePause))
			wake()
			wake()
			assert.Len(t, hook.received(), 3, "called again after the pause, and after a call that worked")
		})
	}
}

// Reading the project's webhooks fails: the wake-up is dropped, not the
// request.
func TestWebhookShipper_AWakeUpSurvivesAFailedRead(t *testing.T) {
	hook := newWakeHook(t)
	src := newFakeWebhookSource(testWebhook("hook_a", "proj_a", "https://endpoint.example"))
	src.filtersErr = errors.New("failed to connect")
	shipper := newHookedWebhookShipper(src, http.DefaultClient, hook, &fakeClock{t: webhookT0})

	shipper.Wake(t.Context(), "proj_a", []domain.EventType{domain.EventTypeUserCreated})
	assert.Empty(t, hook.received())
}

// After a failed delivery no timer of this server's makes the next attempt,
// so the hook is told when it is due (ADR 088 §4: a retry is a delayed
// message).
func TestWebhookShipper_AFailedDeliveryAsksTheHookForItsRetry(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	endpoint.answer(func(string) int { return http.StatusServiceUnavailable })
	hook := newWakeHook(t)
	clock := &fakeClock{t: webhookT0.Add(time.Minute)}
	src := newFakeWebhookSource(testWebhook("hook_a", "proj_a", endpoint.URL))
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
	shipper := newHookedWebhookShipper(src, endpoint.Client(), hook, clock)

	_, err := shipper.runOnce(t.Context(), "proj_a")
	require.NoError(t, err)

	due := clock.Now().Add(webhookBackoffMin)
	assert.Equal(t, []webhookWakeCall{{ProjectID: "proj_a", NotBefore: &due}}, hook.received())
	require.NotNil(t, src.get("hook_a").NextAttemptAt)
	assert.Equal(t, due, *src.get("hook_a").NextAttemptAt, "what the hook is told is what the webhook stores")

	// A webhook that is given up on has no next attempt.
	endpoint.answer(func(string) int { return http.StatusGone })
	clock.Set(due)
	_, err = shipper.runOnce(t.Context(), "proj_a")
	require.NoError(t, err)
	assert.False(t, src.get("hook_a").Enabled)
	assert.Len(t, hook.received(), 1)
}

// An event stored while a round holds the webhook's lease wakes a round that
// finds the webhook taken. The round that held it asks for another as it
// gives the lease back, or the event would wait for the next one.
func TestWebhookShipper_ARoundAsksForAnotherWhenEventsWereStoredUnderIt(t *testing.T) {
	for name, tc := range map[string]struct {
		during domain.EventType
		hidden bool
		wakes  bool
	}{
		"an event the webhook takes":      {during: domain.EventTypeUserCreated, wakes: true},
		"an event the webhook skips":      {during: domain.EventTypeUserDeleted},
		"a project the claim gate hides":  {during: domain.EventTypeUserCreated, hidden: true},
		"nothing stored during the round": {},
	} {
		t.Run(name, func(t *testing.T) {
			endpoint := newWebhookEndpoint(t)
			hook := newWakeHook(t)
			src := newFakeWebhookSource(testWebhook("hook_a", "proj_a", endpoint.URL, string(domain.EventTypeUserCreated)))
			src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
			src.hidden["proj_a"] = tc.hidden
			if tc.during != "" {
				late := &domain.Event{ID: "evt_late", ProjectID: "proj_a", EventType: tc.during, CreatedAt: webhookT0.Add(time.Hour), Payload: []byte(`{}`)}
				if tc.hidden {
					src.addEvents("proj_a", late)
				} else {
					// Stored as the first delivery is answered, after the
					// round listed.
					endpoint.answer(func(string) int {
						src.addEvents("proj_a", late)
						return http.StatusNoContent
					})
				}
			}
			shipper := newHookedWebhookShipper(src, endpoint.Client(), hook, &fakeClock{t: webhookT0})

			_, err := shipper.runOnce(t.Context(), "proj_a")
			require.NoError(t, err)

			if tc.wakes {
				assert.Equal(t, []webhookWakeCall{{ProjectID: "proj_a"}}, hook.received())
				return
			}
			assert.Empty(t, hook.received())
		})
	}
}

func serveWebhookTrigger(trigger http.Handler, query, authorization string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, WebhookTriggerPath+query, nil)
	if authorization != "" {
		r.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	trigger.ServeHTTP(rec, r)
	return rec
}

// What a wake-up calls: the trigger, for the one project, so it leases no
// other project's webhooks.
func TestWebhookShipper_TriggerDeliversForOneProject(t *testing.T) {
	endpoint := newWebhookEndpoint(t)
	src := newFakeWebhookSource(
		testWebhook("hook_a", "proj_a", endpoint.URL),
		testWebhook("hook_b", "proj_b", endpoint.URL),
	)
	src.addEvents("proj_a", testEvents("proj_a", domain.EventTypeUserCreated)...)
	src.addEvents("proj_b", testEvents("proj_b", domain.EventTypeUserCreated)...)
	trigger := newWebhookTrigger(t, src, endpoint.Client())

	rec := serveWebhookTrigger(trigger, "?project_id=proj_a", "")
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "the project's round takes the secret as every round does")
	assert.Empty(t, endpoint.deliveries())

	rec = serveWebhookTrigger(trigger, "?project_id=proj_a", "Bearer "+testTriggerSecret)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"webhooks":1}`, rec.Body.String())
	assert.Equal(t, "evt_1", src.get("hook_a").CursorEventID)
	assert.Empty(t, src.get("hook_b").CursorEventID)
	assert.Equal(t, []string{"proj_a", "proj_a"}, src.leasesOf())

	rec = serveWebhookTrigger(trigger, "?project_id=proj_unknown", "Bearer "+testTriggerSecret)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"webhooks":0}`, rec.Body.String(), "a project with nothing due is no error: the wake-up was late or doubled")

	// Without the parameter the round is every project's, as the hourly
	// call's is.
	rec = serveWebhookTrigger(trigger, "", "Bearer "+testTriggerSecret)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "evt_1", src.get("hook_b").CursorEventID)
}
