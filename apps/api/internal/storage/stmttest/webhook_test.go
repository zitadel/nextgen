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
// while it was disabled (ADR 089 §4): its cursor is past every event stored
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

// leaseDue leases every due webhook to holder until now plus ttl, and returns
// the ids of those in the project: the database is shared, so a lease may
// also take what another test left behind.
func leaseDue(t *testing.T, stmts service.AllStatements, projectID, holder string, now time.Time, ttl time.Duration) []string {
	t.Helper()
	leased, err := stmts.LeaseDueWebhooks(t.Context(), holder, now, now, now.Add(ttl), 1000)
	require.NoError(t, err)
	var ids []string
	for _, hook := range leased {
		if hook.ProjectID != projectID {
			continue
		}
		assert.Equal(t, &holder, hook.LeaseHolder)
		require.NotNil(t, hook.LeaseExpiresAt)
		assert.WithinDuration(t, now.Add(ttl), *hook.LeaseExpiresAt, time.Millisecond)
		ids = append(ids, hook.ID)
	}
	return ids
}

// One sender (ADR 089 §4): a leased webhook goes to nobody else until the
// lease runs out or its holder gives it back, and a holder that lost it
// writes nothing.
func TestWebhookStatements_Lease(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		hook := createWebhook(t, d.stmts, projectID, testWebhookURL)
		now := time.Now().UTC().Truncate(time.Microsecond)

		assert.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, "server-a", now, time.Minute))
		assert.Empty(t, leaseDue(t, d.stmts, projectID, "server-b", now.Add(30*time.Second), time.Minute), "leased to server-a")

		// A crashed holder: the lease runs out and another server takes over.
		later := now.Add(time.Minute)
		assert.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, "server-b", later, time.Minute))
		lost := new(database.NoRowFoundError)
		assert.ErrorIs(t, d.stmts.RecordWebhookProgress(t.Context(), projectID, hook.ID, "server-a", later, "evt-stale", &later), lost)
		assert.ErrorIs(t, d.stmts.RecordWebhookFailure(t.Context(), projectID, hook.ID, "server-a", later, nil, later), lost)
		assert.ErrorIs(t, d.stmts.DisableFailedWebhook(t.Context(), projectID, hook.ID, "server-a", later, nil), lost)
		assert.ErrorIs(t, d.stmts.ReleaseWebhookLease(t.Context(), projectID, hook.ID, "server-a", later), lost)
		got, err := d.stmts.GetWebhook(t.Context(), projectID, hook.ID)
		require.NoError(t, err)
		assert.Equal(t, new("server-b"), got.LeaseHolder)
		assert.Empty(t, got.CursorEventID, "the stale holder moved nothing")
		assert.True(t, got.Enabled)
		assert.Nil(t, got.LastErrorAt)

		// Given back, it is due from the time the holder names.
		require.NoError(t, d.stmts.ReleaseWebhookLease(t.Context(), projectID, hook.ID, "server-b", later.Add(time.Second)))
		got, err = d.stmts.GetWebhook(t.Context(), projectID, hook.ID)
		require.NoError(t, err)
		assert.Nil(t, got.LeaseHolder)
		assert.Nil(t, got.LeaseExpiresAt)
		assert.Empty(t, leaseDue(t, d.stmts, projectID, "server-a", later, time.Minute), "not due yet")
		assert.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, "server-a", later.Add(time.Second), time.Minute))

		// A disabled webhook is never due.
		require.NoError(t, d.stmts.ReleaseWebhookLease(t.Context(), projectID, hook.ID, "server-a", later))
		_, err = d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{Enabled: new(false)})
		require.NoError(t, err)
		assert.Empty(t, leaseDue(t, d.stmts, projectID, "server-a", later.Add(time.Hour), time.Minute))
	})
}

// Servers that lease at the same moment share the due webhooks out: each
// webhook goes to exactly one of them.
func TestWebhookStatements_LeaseHoldsUnderConcurrentCalls(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		want := map[string]int{}
		for range 4 {
			want[createWebhook(t, d.stmts, projectID, testWebhookURL).ID] = 1
		}
		now := time.Now().UTC()

		const racers = 6
		leased := make([][]*domain.Webhook, racers)
		errs := make([]error, racers)
		var wg sync.WaitGroup
		for i := range racers {
			wg.Go(func() {
				leased[i], errs[i] = d.stmts.LeaseDueWebhooks(context.Background(), "server-"+string(rune('a'+i)), now, now, now.Add(time.Minute), 1000)
			})
		}
		wg.Wait()

		got := map[string]int{}
		for i := range racers {
			require.NoError(t, errs[i])
			for _, hook := range leased[i] {
				if hook.ProjectID == projectID {
					got[hook.ID]++
				}
			}
		}
		assert.Equal(t, want, got)
	})
}

// A lease takes no more than its limit, the longest due first.
func TestWebhookStatements_LeaseLimit(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		for range 3 {
			createWebhook(t, d.stmts, projectID, testWebhookURL)
		}
		now := time.Now().UTC()
		leased, err := d.stmts.LeaseDueWebhooks(t.Context(), "server-a", now, now, now.Add(time.Minute), 2)
		require.NoError(t, err)
		assert.Len(t, leased, 2)
		// Give back what the call took, another test's webhooks included.
		for _, hook := range leased {
			require.NoError(t, d.stmts.ReleaseWebhookLease(t.Context(), hook.ProjectID, hook.ID, "server-a", now))
		}
	})
}

func TestWebhookStatements_RecordProgressAndFailure(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		hook := createWebhook(t, d.stmts, projectID, testWebhookURL)
		now := time.Now().UTC().Truncate(time.Microsecond)
		const holder = "server-a"
		get := func() *domain.Webhook {
			t.Helper()
			got, err := d.stmts.GetWebhook(t.Context(), projectID, hook.ID)
			require.NoError(t, err)
			return got
		}
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, holder, now, time.Minute))

		// A failure with no response: no status, failing from now, due again
		// only after the backoff, and the lease is given back.
		require.NoError(t, d.stmts.RecordWebhookFailure(t.Context(), projectID, hook.ID, holder, now, nil, now.Add(5*time.Second)))
		got := get()
		assert.Equal(t, &now, got.LastErrorAt)
		assert.Nil(t, got.LastErrorStatus)
		assert.Equal(t, &now, got.FailingSince)
		assert.Equal(t, new(now.Add(5*time.Second)), got.NextAttemptAt)
		assert.Nil(t, got.LeaseHolder)
		assert.Nil(t, got.LastDeliveredAt)
		assert.Empty(t, leaseDue(t, d.stmts, projectID, holder, now.Add(4*time.Second), time.Minute), "inside the backoff")

		// A second failure keeps the time the webhook has been failing since.
		second := now.Add(5 * time.Second)
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, holder, second, time.Minute))
		require.NoError(t, d.stmts.RecordWebhookFailure(t.Context(), projectID, hook.ID, holder, second, new(int32(503)), second.Add(10*time.Second)))
		got = get()
		assert.Equal(t, &second, got.LastErrorAt)
		assert.Equal(t, new(int32(503)), got.LastErrorStatus)
		assert.Equal(t, &now, got.FailingSince)

		// Passing events the filter skipped moves the cursor and proves
		// nothing about the endpoint.
		third := second.Add(10 * time.Second)
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, holder, third, time.Minute))
		cursorAt := now.Add(-time.Hour)
		require.NoError(t, d.stmts.RecordWebhookProgress(t.Context(), projectID, hook.ID, holder, cursorAt, "evt-skipped", nil))
		got = get()
		assert.Equal(t, cursorAt, got.CursorCreatedAt)
		assert.Equal(t, "evt-skipped", got.CursorEventID)
		assert.Equal(t, &now, got.FailingSince)
		assert.Nil(t, got.LastDeliveredAt)
		assert.Equal(t, new(holder), got.LeaseHolder, "progress keeps the lease")

		// A delivery that succeeded ends the failing state; the last error
		// stays as what it was.
		require.NoError(t, d.stmts.RecordWebhookProgress(t.Context(), projectID, hook.ID, holder, cursorAt.Add(time.Second), "evt-delivered", &third))
		got = get()
		assert.Equal(t, cursorAt.Add(time.Second), got.CursorCreatedAt)
		assert.Equal(t, "evt-delivered", got.CursorEventID)
		assert.Equal(t, &third, got.LastDeliveredAt)
		assert.Nil(t, got.FailingSince)
		assert.Equal(t, &second, got.LastErrorAt)
		assert.Equal(t, new(int32(503)), got.LastErrorStatus)
	})
}

func TestWebhookStatements_DisableFailed(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		hook := createWebhook(t, d.stmts, projectID, testWebhookURL)
		now := time.Now().UTC().Truncate(time.Microsecond)
		const holder = "server-a"
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, holder, now, time.Minute))

		require.NoError(t, d.stmts.DisableFailedWebhook(t.Context(), projectID, hook.ID, holder, now, new(int32(410))))
		got, err := d.stmts.GetWebhook(t.Context(), projectID, hook.ID)
		require.NoError(t, err)
		assert.False(t, got.Enabled)
		assert.Equal(t, &now, got.LastErrorAt)
		assert.Equal(t, new(int32(410)), got.LastErrorStatus)
		assert.Equal(t, &now, got.FailingSince)
		assert.Nil(t, got.LeaseHolder)
		assert.Nil(t, got.LeaseExpiresAt)
		assert.Empty(t, leaseDue(t, d.stmts, projectID, holder, now.Add(time.Hour), time.Minute))

		// Disabled twice is disabled once: the second writer has no row.
		assert.ErrorIs(t, d.stmts.DisableFailedWebhook(t.Context(), projectID, hook.ID, holder, now, nil), new(database.NoRowFoundError))
	})
}

// A webhook the project's admins disabled while a delivery held it is not
// disabled a second time, with a second event.
func TestWebhookStatements_DisableFailedSkipsADisabledWebhook(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		hook := createWebhook(t, d.stmts, projectID, testWebhookURL)
		now := time.Now().UTC()
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, "server-a", now, time.Minute))
		_, err := d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{Enabled: new(false)})
		require.NoError(t, err)

		assert.ErrorIs(t, d.stmts.DisableFailedWebhook(t.Context(), projectID, hook.ID, "server-a", now, nil), new(database.NoRowFoundError))
	})
}

// Enabling a disabled webhook starts it clean (ADR 089 §4): not failing, due
// at once, and out of the hands of a delivery that began before.
func TestWebhookStatements_EnableClearsDeliveryState(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		hook := createWebhook(t, d.stmts, projectID, testWebhookURL)
		now := time.Now().UTC().Truncate(time.Microsecond)
		const holder = "server-a"

		// Failing and inside its backoff, then disabled while leased.
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, holder, now, time.Minute))
		require.NoError(t, d.stmts.RecordWebhookFailure(t.Context(), projectID, hook.ID, holder, now, new(int32(500)), now.Add(time.Hour)))
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, holder, now.Add(time.Hour), time.Minute))
		require.NoError(t, d.stmts.RecordWebhookFailure(t.Context(), projectID, hook.ID, holder, now.Add(time.Hour), new(int32(500)), now.Add(2*time.Hour)))
		require.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, holder, now.Add(2*time.Hour), 24*time.Hour))
		_, err := d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{Enabled: new(false)})
		require.NoError(t, err)

		// Disabling alone keeps the state: enabling an enabled webhook must
		// not be a way around the backoff.
		got, err := d.stmts.GetWebhook(t.Context(), projectID, hook.ID)
		require.NoError(t, err)
		assert.NotNil(t, got.FailingSince)
		assert.Equal(t, new(holder), got.LeaseHolder)

		enabled, err := d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{Enabled: new(true)})
		require.NoError(t, err)
		for name, got := range map[string]*domain.Webhook{"returned": enabled, "stored": nil} {
			if got == nil {
				got, err = d.stmts.GetWebhook(t.Context(), projectID, hook.ID)
				require.NoError(t, err)
			}
			assert.Nil(t, got.FailingSince, name)
			assert.Nil(t, got.NextAttemptAt, name)
			assert.Nil(t, got.LeaseHolder, name)
			assert.Nil(t, got.LeaseExpiresAt, name)
			assert.Equal(t, new(int32(500)), got.LastErrorStatus, name)
		}
		assert.ErrorIs(t, d.stmts.RecordWebhookProgress(t.Context(), projectID, hook.ID, holder, now, "evt-old", &now), new(database.NoRowFoundError),
			"the delivery from before the webhook was disabled records nothing")
		assert.Equal(t, []string{hook.ID}, leaseDue(t, d.stmts, projectID, "server-b", now, time.Minute))

		// Enabling a failing webhook that is enabled keeps its backoff.
		require.NoError(t, d.stmts.RecordWebhookFailure(t.Context(), projectID, hook.ID, "server-b", now, nil, now.Add(time.Hour)))
		_, err = d.stmts.UpdateWebhook(t.Context(), projectID, hook.ID, domain.WebhookUpdate{Enabled: new(true)})
		require.NoError(t, err)
		got, err = d.stmts.GetWebhook(t.Context(), projectID, hook.ID)
		require.NoError(t, err)
		assert.Equal(t, &now, got.FailingSince)
		assert.Equal(t, new(now.Add(time.Hour)), got.NextAttemptAt)
	})
}
