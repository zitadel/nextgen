//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
	api "go.zitadel.com/zitadel/v5/api"
)

// onlyHost refuses every request that is not for host. The database is
// shared, so a round also takes the webhooks other tests created, and those
// name hosts on the internet.
type onlyHost struct {
	host string
	next http.RoundTripper
}

func (o onlyHost) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host != o.host {
		return nil, errors.New("not this test's endpoint")
	}
	return o.next.RoundTrip(r)
}

type webhookDelivery struct {
	header http.Header
	body   []byte
}

// signedWith checks a delivery as a receiver does: one of its signatures is
// the HMAC-SHA256 of id.timestamp.body under the secret's key.
func (d webhookDelivery) signedWith(t *testing.T, secret string) bool {
	t.Helper()
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	require.NoError(t, err)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(d.header.Get("webhook-id") + "." + d.header.Get("webhook-timestamp") + "."))
	mac.Write(d.body)
	want := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	for signature := range strings.FieldsSeq(d.header.Get("webhook-signature")) {
		if hmac.Equal([]byte(signature), []byte(want)) {
			return true
		}
	}
	return false
}

// TestWebhookDelivery runs delivery on a real database, from a webhook
// created over HTTP to the request its endpoint receives (ADR 088 §2 to §4):
// what only the parts together show. The secret the API handed out verifies
// the signature the shipper makes with the stored one, a rotation is signed
// with both, the pre-claim gate holds deliveries back, and a 410 disables the
// webhook and records why. The engine's rules are its own tests
// (internal/audit).
func TestWebhookDelivery(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	projectID := api.ProjectID(project.ID)
	db := harness.EnsureServiceDB(t)

	var (
		mu       sync.Mutex
		received []webhookDelivery
		status   = http.StatusNoContent
	)
	endpoint := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		received = append(received, webhookDelivery{header: r.Header.Clone(), body: body})
		w.WriteHeader(status)
	}))
	t.Cleanup(endpoint.Close)
	take := func() []webhookDelivery {
		mu.Lock()
		defer mu.Unlock()
		got := received
		received = nil
		return got
	}

	httpClient := endpoint.Client()
	httpClient.Transport = onlyHost{host: strings.TrimPrefix(endpoint.URL, "https://"), next: httpClient.Transport}
	const triggerSecret = "0123456789abcdef-webhooks"
	trigger := audit.NewWebhookShipper(
		service.WebhookDeliveryAdapter{Pool: db, Keys: harness.EnsureKeyService(t)},
		httpClient,
		audit.WebhookConfig{Enabled: true, TriggerSecret: triggerSecret},
	).Trigger()
	// deliver runs one round, as a scheduler's call to the trigger does.
	deliver := func(t *testing.T) []webhookDelivery {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, audit.WebhookTriggerPath, nil)
		r.Header.Set("Authorization", "Bearer "+triggerSecret)
		rec := httptest.NewRecorder()
		trigger.ServeHTTP(rec, r)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return take()
	}
	eventTypes := func(t *testing.T, deliveries []webhookDelivery) []string {
		t.Helper()
		types := make([]string, len(deliveries))
		for i, d := range deliveries {
			// The body holds these keys and no other, each one present.
			var keys map[string]json.RawMessage
			require.NoError(t, json.Unmarshal(d.body, &keys))
			assert.ElementsMatch(t, []string{"id", "type", "created_at", "project_id", "actor", "entity", "data"},
				slices.Collect(maps.Keys(keys)), string(d.body))
			var ev struct {
				ID        string `json:"id"`
				Type      string `json:"type"`
				ProjectID string `json:"project_id"`
			}
			require.NoError(t, json.Unmarshal(d.body, &ev))
			assert.Equal(t, ev.ID, d.header.Get("webhook-id"), "webhook-id is the event's id")
			assert.Equal(t, project.ID, ev.ProjectID)
			types[i] = ev.Type
		}
		return types
	}

	res, err := client.CreateWebhook(t.Context(), &api.CreateWebhookRequest{
		URL:        api.WebhookURL(endpoint.URL + "/hooks/zitadel"),
		EventTypes: api.WebhookEventTypes{"*"},
	}, api.CreateWebhookParams{ProjectID: projectID})
	require.NoError(t, err)
	require.IsType(t, &api.WebhookWithSecret{}, res, helpers.MustMarshal(t, res))
	created := res.(*api.WebhookWithSecret)
	stored := func(t *testing.T) *domain.Webhook {
		t.Helper()
		row, err := db.Statements().GetWebhook(t.Context(), project.ID, string(created.ID))
		require.NoError(t, err)
		return row
	}

	t.Run("nothing is delivered before the claim", func(t *testing.T) {
		assert.Empty(t, deliver(t))
		row := stored(t)
		assert.Nil(t, row.LastDeliveredAt)
		assert.Nil(t, row.LastErrorAt)
		assert.Nil(t, row.LeaseHolder)
	})

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: helpers.TeamName()})
	require.NoError(t, err)
	harness.SeedOwningTeam(t, project.ID, team.ID)

	t.Run("after it, what is pending arrives signed with the secret create returned", func(t *testing.T) {
		got := deliver(t)
		require.NotEmpty(t, got)
		types := eventTypes(t, got)
		require.Contains(t, types, "webhook.created", "the events since the webhook was created, its own included")
		assert.NotContains(t, types, "request.api", "* leaves request.api out")
		for _, d := range got {
			assert.True(t, d.signedWith(t, created.Secret), "signature %q", d.header.Get("webhook-signature"))
			assert.Equal(t, "application/json", d.header.Get("Content-Type"))
		}
		// The body names the entity and carries the event's stored payload.
		var ev struct {
			Entity struct {
				Type string `json:"type"`
				ID   string `json:"id"`
			} `json:"entity"`
			Data struct {
				URL string `json:"url"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(got[slices.Index(types, "webhook.created")].body, &ev))
		assert.Equal(t, "webhook", ev.Entity.Type)
		assert.Equal(t, string(created.ID), ev.Entity.ID)
		assert.Equal(t, endpoint.URL+"/hooks/zitadel", ev.Data.URL)
		row := stored(t)
		assert.NotNil(t, row.LastDeliveredAt)
		assert.Nil(t, row.FailingSince)

		assert.Empty(t, deliver(t), "delivered once: the cursor moved")
	})

	t.Run("during a rotation a delivery is signed with both secrets", func(t *testing.T) {
		res, err := client.RotateWebhookSecret(t.Context(), api.RotateWebhookSecretParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.WebhookWithSecret{}, res, helpers.MustMarshal(t, res))
		rotated := res.(*api.WebhookWithSecret)

		got := deliver(t)
		require.Len(t, got, 1)
		assert.Equal(t, []string{"webhook.secret_rotated"}, eventTypes(t, got))
		assert.Len(t, strings.Fields(got[0].header.Get("webhook-signature")), 2)
		assert.True(t, got[0].signedWith(t, rotated.Secret))
		assert.True(t, got[0].signedWith(t, created.Secret))
	})

	t.Run("an endpoint that answers 410 is disabled, with its event", func(t *testing.T) {
		upd, err := client.UpdateWebhook(t.Context(), &api.UpdateWebhookRequest{
			Description: api.NewOptString("Gone"),
		}, api.UpdateWebhookParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.Webhook{}, upd, helpers.MustMarshal(t, upd))
		mu.Lock()
		status = http.StatusGone
		mu.Unlock()

		got := deliver(t)
		require.Len(t, got, 1)
		assert.Equal(t, []string{"webhook.updated"}, eventTypes(t, got))

		res, err := client.GetWebhook(t.Context(), api.GetWebhookParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.Webhook{}, res, helpers.MustMarshal(t, res))
		hook := res.(*api.Webhook)
		assert.False(t, hook.Enabled)
		lastStatus, ok := hook.LastErrorStatus.Get()
		require.True(t, ok, helpers.MustMarshal(t, res))
		assert.EqualValues(t, http.StatusGone, lastStatus)
		assert.Nil(t, stored(t).LeaseHolder)

		opts := events.ListOptions(project.ID, 100)
		opts.Filter = database.And(opts.Filter, database.Equal(database.Col(domain.EventFieldEventType), string(domain.EventTypeWebhookDisabled)))
		page, err := db.Statements().ListEvents(t.Context(), opts)
		require.NoError(t, err)
		require.Len(t, page.Items, 1)
		disabled := page.Items[0]
		assert.Equal(t, new(string(created.ID)), disabled.EntityID)
		assert.Equal(t, new(domain.EventActorTypeSystem), disabled.ActorType)
		assert.JSONEq(t, `{"reason":"gone"}`, string(disabled.Payload))

		assert.Empty(t, deliver(t), "a disabled webhook is sent nothing, its own webhook.disabled included")
	})

	t.Run("the events API returns webhook.disabled", func(t *testing.T) {
		res, err := client.ListEvents(t.Context(), api.ListEventsParams{ProjectID: projectID, Limit: api.NewOptLimit(100)})
		require.NoError(t, err)
		require.IsType(t, &api.ListEventsResponse{}, res, helpers.MustMarshal(t, res))
		assert.Contains(t, helpers.MustMarshal(t, res), `"event_type":"webhook.disabled"`)
	})
}
