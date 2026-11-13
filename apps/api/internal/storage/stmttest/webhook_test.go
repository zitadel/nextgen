//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const testWebhookURL = "https://example.invalid/hooks/zitadel"

// createWebhook creates a webhook in the project, which the project's cleanup
// removes with it.
func createWebhook(t *testing.T, stmts service.AllStatements, projectID, url string) *domain.Webhook {
	t.Helper()
	entity := &domain.Webhook{
		ProjectID:   projectID,
		URL:         url,
		Description: "User sync",
		EventTypes:  []string{"user.created", "user.deleted"},
		Secret:      "ciphertext-1",
	}
	require.NoError(t, stmts.CreateWebhook(t.Context(), entity))
	return entity
}

// eventsAfterWebhookCursor lists the ids of the events the webhook's cursor
// has not passed: what a delivery would send next.
func eventsAfterWebhookCursor(t *testing.T, stmts service.AllStatements, hook *domain.Webhook) []string {
	t.Helper()
	stored, err := stmts.GetWebhook(t.Context(), hook.ProjectID, hook.ID)
	require.NoError(t, err)
	events, err := stmts.ListEventsAfterCursor(t.Context(), hook.ProjectID, stored.CursorCreatedAt, stored.CursorEventID, 100)
	require.NoError(t, err)
	ids := make([]string, len(events))
	for i, event := range events {
		ids[i] = event.ID
	}
	return ids
}

func TestWebhookStatements_CreateGetUpdateDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		created := createWebhook(t, d.stmts, projectID, testWebhookURL)

		assert.True(t, domain.PrefixWebhook.Matches(created.ID), "id %q", created.ID)
		assert.True(t, created.Enabled)
		assert.WithinDuration(t, time.Now(), created.CreatedAt, time.Minute)

		got, err := d.stmts.GetWebhook(t.Context(), projectID, created.ID)
		require.NoError(t, err)
		assert.False(t, got.CursorCreatedAt.IsZero())
		assert.Equal(t, &domain.Webhook{
			ID:              created.ID,
			ProjectID:       projectID,
			URL:             testWebhookURL,
			Description:     "User sync",
			EventTypes:      []string{"user.created", "user.deleted"},
			Enabled:         true,
			Secret:          "ciphertext-1",
			CursorCreatedAt: got.CursorCreatedAt,
			CreatedAt:       created.CreatedAt,
		}, got)

		// Each field alone: the others keep their stored value.
		updated, err := d.stmts.UpdateWebhook(t.Context(), projectID, created.ID, domain.WebhookUpdate{URL: new(testWebhookURL + "/v2")})
		require.NoError(t, err)
		want := *got
		want.URL = testWebhookURL + "/v2"
		assert.Equal(t, &want, updated)

		updated, err = d.stmts.UpdateWebhook(t.Context(), projectID, created.ID, domain.WebhookUpdate{Description: new("")})
		require.NoError(t, err)
		want.Description = ""
		assert.Equal(t, &want, updated)

		updated, err = d.stmts.UpdateWebhook(t.Context(), projectID, created.ID, domain.WebhookUpdate{EventTypes: []string{"*"}})
		require.NoError(t, err)
		want.EventTypes = []string{"*"}
		assert.Equal(t, &want, updated)

		updated, err = d.stmts.UpdateWebhook(t.Context(), projectID, created.ID, domain.WebhookUpdate{Enabled: new(false)})
		require.NoError(t, err)
		want.Enabled = false
		assert.Equal(t, &want, updated)

		got, err = d.stmts.GetWebhook(t.Context(), projectID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, &want, got)

		require.NoError(t, d.stmts.DeleteWebhook(t.Context(), projectID, created.ID))
		_, err = d.stmts.GetWebhook(t.Context(), projectID, created.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A webhook is reachable only through its own project, and an id that names
// nothing answers the same.
func TestWebhookStatements_NotFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProjectID := ensureProject(t, d.stmts)
		created := createWebhook(t, d.stmts, projectID, testWebhookURL)

		for name, tc := range map[string]struct{ projectID, id string }{
			"another project's id": {otherProjectID, created.ID},
			"unknown id":           {projectID, "hook_unknown"},
		} {
			t.Run(name, func(t *testing.T) {
				_, err := d.stmts.GetWebhook(t.Context(), tc.projectID, tc.id)
				assert.ErrorIs(t, err, new(database.NoRowFoundError))
				_, err = d.stmts.UpdateWebhook(t.Context(), tc.projectID, tc.id, domain.WebhookUpdate{Enabled: new(false)})
				assert.ErrorIs(t, err, new(database.NoRowFoundError))
				_, err = d.stmts.UpdateWebhook(t.Context(), tc.projectID, tc.id, domain.WebhookUpdate{Enabled: new(true)})
				assert.ErrorIs(t, err, new(database.NoRowFoundError))
				_, err = d.stmts.RotateWebhookSecret(t.Context(), tc.projectID, tc.id, "ciphertext-2", time.Now().Add(time.Hour))
				assert.ErrorIs(t, err, new(database.NoRowFoundError))
				assert.ErrorIs(t, d.stmts.DeleteWebhook(t.Context(), tc.projectID, tc.id), new(database.NoRowFoundError))
			})
		}

		list, err := d.stmts.ListWebhooks(t.Context(), otherProjectID, database.Page[domain.WebhookField]{Limit: 10})
		require.NoError(t, err)
		assert.Empty(t, list.Items)

		got, err := d.stmts.GetWebhook(t.Context(), projectID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, "ciphertext-1", got.Secret, "the other project's calls changed nothing")
		assert.True(t, got.Enabled)
	})
}

func TestWebhookStatements_ListNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		var want []string
		for range 3 {
			want = append([]string{createWebhook(t, d.stmts, projectID, testWebhookURL).ID}, want...)
			// Apart in created_at, so the order does not fall to the id.
			time.Sleep(2 * time.Millisecond)
		}
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Webhook], error) {
			return d.stmts.ListWebhooks(t.Context(), projectID, database.Page[domain.WebhookField]{Limit: 2, Cursor: cursor})
		}, func(w *domain.Webhook) string { return w.ID })
		assert.Equal(t, want, got)
	})
}

func TestWebhookStatements_RotateSecret(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		created := createWebhook(t, d.stmts, projectID, testWebhookURL)
		expires := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Microsecond)

		rotated, err := d.stmts.RotateWebhookSecret(t.Context(), projectID, created.ID, "ciphertext-2", expires)
		require.NoError(t, err)
		assert.Equal(t, "ciphertext-2", rotated.Secret)
		assert.Equal(t, new("ciphertext-1"), rotated.PreviousSecret)
		assert.Equal(t, &expires, rotated.PreviousSecretExpiresAt)

		// A second rotation inside the window drops the older of the two.
		later := expires.Add(time.Hour)
		rotated, err = d.stmts.RotateWebhookSecret(t.Context(), projectID, created.ID, "ciphertext-3", later)
		require.NoError(t, err)
		assert.Equal(t, "ciphertext-3", rotated.Secret)
		assert.Equal(t, new("ciphertext-2"), rotated.PreviousSecret)
		assert.Equal(t, &later, rotated.PreviousSecretExpiresAt)

		got, err := d.stmts.GetWebhook(t.Context(), projectID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, rotated, got)
	})
}

func TestWebhookStatements_ProjectLimit(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProjectID := ensureProject(t, d.stmts)
		var last *domain.Webhook
		for range domain.WebhookProjectLimit {
			last = createWebhook(t, d.stmts, projectID, testWebhookURL)
		}

		refused := &domain.Webhook{ProjectID: projectID, URL: testWebhookURL, EventTypes: []string{"*"}, Secret: "ciphertext-1"}
		err := d.stmts.CreateWebhook(t.Context(), refused)
		require.ErrorIs(t, err, domain.ErrWebhookLimitReached())

		// The limit is the project's own, and a delete frees a place.
		createWebhook(t, d.stmts, otherProjectID, testWebhookURL)
		require.NoError(t, d.stmts.DeleteWebhook(t.Context(), projectID, last.ID))
		createWebhook(t, d.stmts, projectID, testWebhookURL)

		list, err := d.stmts.ListWebhooks(t.Context(), projectID, database.Page[domain.WebhookField]{})
		require.NoError(t, err)
		assert.Len(t, list.Items, domain.WebhookProjectLimit)
	})
}

// Creates that race for the project's last places must not overshoot the
// limit: each sees the others' webhooks before it writes its own.
func TestWebhookStatements_ProjectLimitHoldsUnderConcurrentCreates(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		const free, racers = 2, 6
		for range domain.WebhookProjectLimit - free {
			createWebhook(t, d.stmts, projectID, testWebhookURL)
		}

		errs := make([]error, racers)
		var wg sync.WaitGroup
		for i := range racers {
			wg.Go(func() {
				errs[i] = d.stmts.CreateWebhook(context.Background(), &domain.Webhook{
					ProjectID: projectID, URL: testWebhookURL, EventTypes: []string{"*"}, Secret: "ciphertext-1",
				})
			})
		}
		wg.Wait()

		won := 0
		for _, err := range errs {
			if err == nil {
				won++
				continue
			}
			assert.ErrorIs(t, err, domain.ErrWebhookLimitReached())
		}
		assert.Equal(t, free, won)
		list, err := d.stmts.ListWebhooks(t.Context(), projectID, database.Page[domain.WebhookField]{})
		require.NoError(t, err)
		assert.Len(t, list.Items, domain.WebhookProjectLimit)
	})
}

// A URL is not a key: two webhooks of one project, and one of another
// project, can name the same one.
func TestWebhookStatements_SharedURL(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProjectID := ensureProject(t, d.stmts)

		first := createWebhook(t, d.stmts, projectID, testWebhookURL)
		second := createWebhook(t, d.stmts, projectID, testWebhookURL)
		third := createWebhook(t, d.stmts, otherProjectID, testWebhookURL)
		assert.Len(t, map[string]struct{}{first.ID: {}, second.ID: {}, third.ID: {}}, 3)
	})
}

func TestWebhookStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		created := createWebhook(t, d.stmts, projectID, testWebhookURL)

		deleted, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)
		require.True(t, deleted)

		_, err = d.stmts.GetWebhook(t.Context(), projectID, created.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A new webhook gets no history, and an enabled one nothing of what happened
// while it was disabled (ADR 090 §4): its cursor is past every event stored
// before, and before every event stored after.
func TestWebhookStatements_CursorStartsAtNow(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		insert := func(id string) {
			t.Helper()
			require.NoError(t, d.stmts.InsertEvent(t.Context(), sampleEvent(projectID, id)))
		}

		insert("evt-1-before-create")
		hook := createWebhook(t, d.stmts, projectID, testWebhookURL)
		assert.Empty(t, eventsAfterWebhookCursor(t, d.stmts, hook))
		insert("evt-2-after-create")
		assert.Equal(t, []string{"evt-2-after-create"}, eventsAfterWebhookCursor(t, d.stmts, hook))

		// Neither a change of URL nor disabling moves the cursor.
		_, err := d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{URL: new(testWebhookURL + "/v2"), Enabled: new(false)})
		require.NoError(t, err)
		insert("evt-3-while-disabled")
		assert.Equal(t, []string{"evt-2-after-create", "evt-3-while-disabled"}, eventsAfterWebhookCursor(t, d.stmts, hook))

		enabled, err := d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{Enabled: new(true)})
		require.NoError(t, err)
		assert.True(t, enabled.Enabled)
		assert.Empty(t, eventsAfterWebhookCursor(t, d.stmts, hook))
		insert("evt-4-after-enable")
		assert.Equal(t, []string{"evt-4-after-enable"}, eventsAfterWebhookCursor(t, d.stmts, hook))

		// Enabling a webhook that is enabled keeps its backlog.
		_, err = d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{Enabled: new(true)})
		require.NoError(t, err)
		assert.Equal(t, []string{"evt-4-after-enable"}, eventsAfterWebhookCursor(t, d.stmts, hook))
	})
}
