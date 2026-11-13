//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestWebhooks covers the webhook operations over HTTP on a real database
// (ADR 090): that each one answers its contract, that the secret is stored
// under the project's key and shown only by create and rotate, and that every
// write is recorded without it. What a body may hold is the service's test.
func TestWebhooks(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	projectID := api.ProjectID(project.ID)

	// decrypt reads a stored secret back with the project's secret key.
	decrypt := func(t *testing.T, stored string) string {
		t.Helper()
		crypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeSecret)
		require.NoError(t, err)
		plain, err := crypter.Decrypt(stored)
		require.NoError(t, err)
		return plain
	}
	stored := func(t *testing.T, id api.WebhookID) *domain.Webhook {
		t.Helper()
		row, err := harness.EnsureServiceDB(t).Statements().GetWebhook(t.Context(), project.ID, string(id))
		require.NoError(t, err)
		return row
	}

	res, err := client.CreateWebhook(t.Context(), &api.CreateWebhookRequest{
		URL:         "https://api.acme.com/hooks/zitadel?token=t0p",
		Description: api.NewOptString("User sync"),
		EventTypes:  api.WebhookEventTypes{"user.created", "user.deleted"},
	}, api.CreateWebhookParams{ProjectID: projectID})
	require.NoError(t, err)
	require.IsType(t, &api.WebhookWithSecret{}, res, helpers.MustMarshal(t, res))
	created := res.(*api.WebhookWithSecret)
	firstSecret := created.Secret

	t.Run("create returns the webhook with its secret", func(t *testing.T) {
		assert.True(t, strings.HasPrefix(string(created.ID), "hook_"))
		assert.Equal(t, projectID, created.ProjectID)
		assert.Equal(t, api.WebhookURL("https://api.acme.com/hooks/zitadel?token=t0p"), created.URL)
		assert.Equal(t, "User sync", created.Description)
		assert.Equal(t, api.WebhookEventTypes{"user.created", "user.deleted"}, created.EventTypes)
		assert.True(t, created.Enabled)
		assert.True(t, created.LastDeliveredAt.Null)
		assert.True(t, created.PreviousSecretExpiresAt.Null)
		assert.True(t, strings.HasPrefix(firstSecret, "whsec_"))

		row := stored(t, created.ID)
		assert.NotContains(t, row.Secret, firstSecret, "the secret is not stored in clear")
		assert.Equal(t, firstSecret, decrypt(t, row.Secret), "the project's secret key reads it back")
	})

	t.Run("create refuses a type the server does not write", func(t *testing.T) {
		res, err := client.CreateWebhook(t.Context(), &api.CreateWebhookRequest{
			URL:        "https://api.acme.com/hooks/zitadel",
			EventTypes: api.WebhookEventTypes{"user.exploded"},
		}, api.CreateWebhookParams{ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.CreateWebhookBadRequest{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t, api.ErrorCode("webhook.invalid"), res.(*api.CreateWebhookBadRequest).Code)
	})

	t.Run("get returns it without the secret", func(t *testing.T) {
		res, err := client.GetWebhook(t.Context(), api.GetWebhookParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.Webhook{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t, created.ID, res.(*api.Webhook).ID)
		assert.NotContains(t, helpers.MustMarshal(t, res), "whsec_")
	})

	t.Run("list returns it", func(t *testing.T) {
		res, err := client.ListWebhooks(t.Context(), api.ListWebhooksParams{ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.ListWebhooksResponse{}, res, helpers.MustMarshal(t, res))
		list := res.(*api.ListWebhooksResponse)
		require.Len(t, list.Data, 1)
		assert.Equal(t, created.ID, list.Data[0].ID)
		assert.False(t, list.NextPageToken.Set && !list.NextPageToken.Null, "one webhook is one page")
	})

	t.Run("update writes the named fields only", func(t *testing.T) {
		res, err := client.UpdateWebhook(t.Context(), &api.UpdateWebhookRequest{
			Enabled: api.NewOptBool(false),
		}, api.UpdateWebhookParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.Webhook{}, res, helpers.MustMarshal(t, res))
		updated := res.(*api.Webhook)
		assert.False(t, updated.Enabled)
		assert.Equal(t, created.URL, updated.URL)
		assert.Equal(t, created.EventTypes, updated.EventTypes)
		assert.Equal(t, firstSecret, decrypt(t, stored(t, created.ID).Secret), "an update keeps the secret")
	})

	t.Run("rotate issues a new secret and keeps the previous one for 24 hours", func(t *testing.T) {
		before := time.Now()
		res, err := client.RotateWebhookSecret(t.Context(), api.RotateWebhookSecretParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.WebhookWithSecret{}, res, helpers.MustMarshal(t, res))
		rotated := res.(*api.WebhookWithSecret)
		assert.True(t, strings.HasPrefix(rotated.Secret, "whsec_"))
		assert.NotEqual(t, firstSecret, rotated.Secret)
		expires, ok := rotated.PreviousSecretExpiresAt.Get()
		require.True(t, ok, helpers.MustMarshal(t, res))
		// A second of slack either side: the column keeps less than a nanosecond.
		assert.WithinRange(t, expires, before.Add(24*time.Hour-time.Second), time.Now().Add(24*time.Hour+time.Second))

		row := stored(t, created.ID)
		assert.Equal(t, rotated.Secret, decrypt(t, row.Secret))
		require.NotNil(t, row.PreviousSecret)
		assert.Equal(t, firstSecret, decrypt(t, *row.PreviousSecret))
	})

	t.Run("delete removes it", func(t *testing.T) {
		res, err := client.DeleteWebhook(t.Context(), api.DeleteWebhookParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteWebhookNoContent{}, res, helpers.MustMarshal(t, res))

		got, err := client.GetWebhook(t.Context(), api.GetWebhookParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.GetWebhookNotFound{}, got, helpers.MustMarshal(t, got))
		assert.Equal(t, api.ErrorCode("webhook.not_found"), got.(*api.GetWebhookNotFound).Code)

		again, err := client.DeleteWebhook(t.Context(), api.DeleteWebhookParams{ID: created.ID, ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteWebhookNotFound{}, again, helpers.MustMarshal(t, again))
	})

	// Runs after the writes above: each one committed its event with its row.
	t.Run("every write is recorded, without a secret", func(t *testing.T) {
		// Read through the statements: the events API hides the events of a
		// project nobody has claimed, and this one was created in-process.
		opts := events.ListOptions(project.ID, 100)
		opts.Filter = database.And(opts.Filter, database.Equal(database.Col(domain.EventFieldEntityType), "webhook"))
		page, err := harness.EnsureServiceDB(t).Statements().ListEvents(t.Context(), opts)
		require.NoError(t, err)

		got := make([]domain.EventType, 0, len(page.Items))
		for _, event := range page.Items {
			require.NotNil(t, event.EntityID)
			assert.Equal(t, string(created.ID), *event.EntityID)
			assert.NotContains(t, string(event.Payload), "whsec_")
			assert.NotContains(t, string(event.Payload), "secret")
			assert.NotContains(t, string(event.Payload), "t0p", "the url is recorded without its query")
			got = append(got, event.EventType)
		}
		assert.Equal(t, []domain.EventType{
			domain.EventTypeWebhookCreated,
			domain.EventTypeWebhookUpdated,
			domain.EventTypeWebhookSecretRotated,
			domain.EventTypeWebhookDeleted,
		}, got)
	})

	t.Run("an update that names no field is refused", func(t *testing.T) {
		// The typed client cannot send an empty body, which the decoder
		// refuses before the webhook is looked up.
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPatch,
			harness.APIBaseURL(t)+"/webhooks/"+string(created.ID)+"?project_id="+project.ID, strings.NewReader(`{}`))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+client.Token())
		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})
}
