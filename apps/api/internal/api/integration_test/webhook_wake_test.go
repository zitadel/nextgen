//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestWebhookWakeUp runs the wake-up on a real database (ADR 090 §4): a
// mutation's commit, seen by the pool the service writes through, starts the
// project's round on a shipper whose timer never fires in the test. What only
// the parts together show: the event is settled and listed by the time the
// wake-up arrives, and the round is the project's own.
//
// Not parallel: TestWebhookDelivery's rounds take every project's webhooks
// and fail this one's at their own endpoint check, which backs it off past
// the wake-up. A test that is not parallel has ended, and deleted its
// project, before a parallel one runs.
func TestWebhookWakeUp(t *testing.T) {

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: helpers.TeamName()})
	require.NoError(t, err)
	harness.SeedOwningTeam(t, project.ID, team.ID)

	var (
		mu       sync.Mutex
		received []string
	)
	endpoint := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var ev struct {
			EventType string `json:"type"`
		}
		_ = json.Unmarshal(body, &ev)
		mu.Lock()
		defer mu.Unlock()
		received = append(received, ev.EventType)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(endpoint.Close)
	delivered := func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), received...)
	}

	// A pool of the test's own over the shared one: only what this test
	// writes through it wakes the shipper, and a wake-up's round leases the
	// woken project's webhooks, so no other test's webhook is touched.
	db := service.NewPool(harness.EnsureServiceDB(t))
	keys := harness.EnsureKeyService(t)
	httpClient := endpoint.Client()
	httpClient.Transport = onlyHost{host: strings.TrimPrefix(endpoint.URL, "https://"), next: httpClient.Transport}
	shipper := audit.NewWebhookShipper(
		service.WebhookDeliveryAdapter{Pool: db, Keys: keys},
		httpClient,
		audit.WebhookConfig{Enabled: true, Interval: time.Hour},
	)
	db.NotifyEventsStored(shipper.Wake)
	shipper.Start()
	t.Cleanup(shipper.Close)

	webhooks := service.NewWebhookService(db, keys)
	hook, _, err := webhooks.Create(t.Context(), service.CreateWebhookInput{
		ProjectID:  project.ID,
		URL:        endpoint.URL + "/hooks/zitadel",
		EventTypes: []string{string(domain.EventTypeWebhookUpdated)},
	})
	require.NoError(t, err)

	_, err = webhooks.Update(t.Context(), project.ID, hook.ID, domain.WebhookUpdate{Description: new("Woken")})
	require.NoError(t, err)

	require.Eventually(t, func() bool { return len(delivered()) > 0 }, 10*time.Second, 10*time.Millisecond,
		"delivered on the commit; the timer is an hour away")
	assert.Equal(t, []string{"webhook.updated"}, delivered())
}
