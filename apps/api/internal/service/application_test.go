package service_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const appProjectID = "proj_app"

const (
	shopWeb      = `{"slug":"web","type":"confidential","grant_types":["authorization_code"],"redirect_uris":["https://shop.example.com/callback"]}`
	shopWebFixed = `{"slug":"web","client_id":"shop-web","type":"confidential","grant_types":["authorization_code"],"redirect_uris":["https://shop.example.com/callback"]}`
	shopAdmin    = `{"slug":"admin","client_id":"shop-admin","type":"confidential","grant_types":["authorization_code"],"redirect_uris":["https://admin.shop.example.com/callback"]}`
)

func TestApplicationService_CreateOrRevise(t *testing.T) {
	t.Parallel()

	t.Run("a new slug creates the application with a secret for every client", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, app *domain.Application, clients []*domain.ApplicationClient) error {
				assert.Equal(t, "shop", app.Slug)
				require.Len(t, clients, 2)
				assert.Equal(t, "", clients[0].ClientID, "storage generates the id the document left out")
				assert.Equal(t, "shop-admin", clients[1].ClientID)
				app.ID, app.RevisionID = "app_1", "apprev_1"
				clients[0].ID, clients[1].ID = "client_1", "client_2"
				clients[0].ClientID = "client_1"
				return nil
			},
		)
		secrets := f.expectSecrets(2)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWeb, shopAdmin), "")
		require.NoError(t, err)
		assert.True(t, got.Created)
		assert.Equal(t, "app_1", got.Application.ID)
		assert.Equal(t, []service.ApplicationClientSecret{
			{Slug: "web", ClientID: "client_1", Secret: "sk_client_1"},
			{Slug: "admin", ClientID: "shop-admin", Secret: "sk_client_2"},
		}, got.Secrets)
		assert.Equal(t, []*domain.ApplicationClientSecret{
			{ProjectID: appProjectID, ApplicationClientID: "client_1", SecretHash: domain.HashSecret("sk_client_1")},
			{ProjectID: appProjectID, ApplicationClientID: "client_2", SecretHash: domain.HashSecret("sk_client_2")},
		}, *secrets, "each client stores the hash of the secret it was returned")

		require.Len(t, *f.events, 1)
		ev := (*f.events)[0]
		assert.Equal(t, domain.EventTypeApplicationCreated, ev.EventType)
		assert.Equal(t, domain.EventCategoryAdmin, ev.Category)
		assert.Equal(t, "application", *ev.EntityType)
		assert.Equal(t, "app_1", *ev.EntityID)
		assert.JSONEq(t,
			`{"slug":"shop","name":"Shop","client_ids":["client_1","shop-admin"],"revision_id":"apprev_1"}`,
			string(ev.Payload), "the payload is the allowlist only: no document, no secret")
	})

	t.Run("an existing slug revises and only the new client gets a secret", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
		f.expectLockedRead(storedShop())
		f.tx.EXPECT().ReviseApplication(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, app *domain.Application, clients []*domain.ApplicationClient) error {
				assert.Equal(t, "app_1", app.ID)
				require.Len(t, clients, 1)
				assert.Equal(t, "admin", clients[0].Slug)
				app.RevisionID = "apprev_2"
				clients[0].ID = "client_2"
				return nil
			},
		)
		secrets := f.expectSecrets(1)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWeb, shopAdmin), "")
		require.NoError(t, err)
		assert.False(t, got.Created)
		assert.Equal(t, []service.ApplicationClientSecret{{Slug: "admin", ClientID: "shop-admin", Secret: "sk_client_1"}}, got.Secrets)
		assert.Equal(t, []*domain.ApplicationClientSecret{
			{ProjectID: appProjectID, ApplicationClientID: "client_2", SecretHash: domain.HashSecret("sk_client_1")},
		}, *secrets)

		require.Len(t, *f.events, 1)
		ev := (*f.events)[0]
		assert.Equal(t, domain.EventTypeApplicationUpdated, ev.EventType)
		assert.Equal(t, "app_1", *ev.EntityID)
		assert.JSONEq(t, `{"client_ids":["shop-admin"],"revision_id":"apprev_2"}`, string(ev.Payload), "an unchanged name stays out of the delta")
	})

	t.Run("a renaming revision that adds no client returns no secrets", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
		f.expectLockedRead(storedShop())
		f.tx.EXPECT().ReviseApplication(gomock.Any(), gomock.Any(), gomock.Len(0)).DoAndReturn(
			func(_ context.Context, app *domain.Application, _ []*domain.ApplicationClient) error {
				app.RevisionID = "apprev_2"
				return nil
			},
		)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, []byte(`{"slug":"shop","name":"Shop 2","clients":[`+shopWeb+`]}`), "")
		require.NoError(t, err)
		assert.Empty(t, got.Secrets)

		require.Len(t, *f.events, 1)
		assert.JSONEq(t, `{"name":"Shop 2","revision_id":"apprev_2"}`, string((*f.events)[0].Payload))
	})

	t.Run("losing the create race revises the application that won", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		gomock.InOrder(
			f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil)),
			f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil),
		)
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("applications", "applications_slug", nil))
		f.expectLockedRead(storedShop())
		f.tx.EXPECT().ReviseApplication(gomock.Any(), gomock.Any(), gomock.Len(0)).Return(nil)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWebFixed), "")
		require.NoError(t, err)
		assert.False(t, got.Created)
		assert.Equal(t, "app_1", got.Application.ID)

		require.Len(t, *f.events, 1, "the failed create emits nothing")
		assert.Equal(t, domain.EventTypeApplicationUpdated, (*f.events)[0].EventType)
	})

	t.Run("a create whose client_id another client holds is client_id_taken", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil)).Times(2)
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("application_clients", "application_clients_client_id", nil))
		f.pool.EXPECT().GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-web").
			Return(&domain.ApplicationClient{ApplicationID: "app_other", ClientID: "shop-web"}, nil)

		_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWebFixed), "")
		assert.ErrorIs(t, err, domain.ErrApplicationClientIDTaken())
	})

	// A revision's UniqueError is told apart by whether another client holds
	// the new client's client_id.
	for name, tc := range map[string]struct {
		holder *domain.ApplicationClient
		lookup error
		want   error
	}{
		"a revision whose new client_id another client holds is client_id_taken": {
			holder: &domain.ApplicationClient{ApplicationID: "app_other", ClientID: "shop-admin"},
			want:   domain.ErrApplicationClientIDTaken(),
		},
		"a revision whose new client_id is free raced another revision": {
			lookup: database.NewNoRowFoundError(nil),
			want:   domain.ErrApplicationRevisionConflict(),
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newApplicationFixture(t)
			f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
			f.expectLockedRead(storedShop())
			f.tx.EXPECT().ReviseApplication(gomock.Any(), gomock.Any(), gomock.Any()).
				Return(database.NewUniqueError("", "", nil))
			f.pool.EXPECT().GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-admin").
				Return(tc.holder, tc.lookup)

			_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWeb, shopAdmin), "")
			assert.ErrorIs(t, err, tc.want)
		})
	}

	t.Run("an event the store refuses fails the create and returns no secret", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		*f.eventErr = errors.New("event insert failed")
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
		f.expectSecrets(1)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWeb), "")
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
		assert.Nil(t, got, "a secret for a write that rolled back would never work")
	})

	t.Run("a project deleted before the create is not found", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(database.NewForeignKeyError("applications", "fk_applications_project", nil))

		_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWeb), "")
		assert.ErrorIs(t, err, domain.ErrApplicationNotFound())
	})

	t.Run("an application gone before the lock is not found", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
		f.tx.EXPECT().LockApplication(gomock.Any(), appProjectID, "app_1").Return(database.NewNoRowFoundError(nil))

		_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWeb), "")
		assert.ErrorIs(t, err, domain.ErrApplicationNotFound())
	})

	// Spanner reports a spent retry budget as UnavailableError; the caller can
	// retry, so it must not become an internal error.
	unavailable := database.NewUnavailableError(errors.New("retry budget spent"))
	for name, expect := range map[string]func(f applicationFixture){
		"a read the database cannot serve is unavailable": func(f applicationFixture) {
			f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, unavailable)
		},
		"a create the database cannot serve is unavailable": func(f applicationFixture) {
			f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
			f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).Return(unavailable)
		},
		"a revision the database cannot serve is unavailable": func(f applicationFixture) {
			f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
			f.tx.EXPECT().LockApplication(gomock.Any(), appProjectID, "app_1").Return(unavailable)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newApplicationFixture(t)
			expect(f)

			_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, shopDocument(shopWeb), "")
			assert.ErrorIs(t, err, domain.ErrUnavailable())
		})
	}

	t.Run("a document the schema refuses stores nothing", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)

		_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, []byte(`{"slug":"shop","name":"Shop","clients":[]}`), "")
		assert.ErrorIs(t, err, domain.ErrRequestInvalid())
	})
}

// The cases of TestApplicationService_CreateOrRevise send no key: the strict
// mocks fail them on any idempotency key statement.
func TestApplicationService_IdempotencyKey(t *testing.T) {
	t.Parallel()
	const key = "key-1"
	document := shopDocument(shopWebFixed)
	record := func(requestDocument []byte, clientIDs ...string) *domain.ApplicationIdempotencyKey {
		return &domain.ApplicationIdempotencyKey{
			ProjectID:     appProjectID,
			KeyHash:       domain.HashSecret(key),
			RequestHash:   domain.HashSecret(string(requestDocument)),
			ApplicationID: "app_1",
			Created:       true,
			ClientIDs:     clientIDs,
		}
	}
	expectRecord := func(f applicationFixture, stored *domain.ApplicationIdempotencyKey) *servicemocks.MockAllStatementsGetApplicationIdempotencyKeyCall {
		if stored == nil {
			return f.pool.EXPECT().GetApplicationIdempotencyKey(gomock.Any(), appProjectID, domain.HashSecret(key), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		}
		return f.pool.EXPECT().GetApplicationIdempotencyKey(gomock.Any(), appProjectID, domain.HashSecret(key), gomock.Any()).Return(stored, nil)
	}
	// expectReplay expects the replay's locked reads of storedShop, which holds
	// the client web as row client_1.
	expectReplay := func(f applicationFixture) {
		f.expectLockedRead(storedShop())
		f.tx.EXPECT().ListApplicationClients(gomock.Any(), appProjectID, "app_1").
			Return([]*domain.ApplicationClient{{ProjectID: appProjectID, ApplicationID: "app_1", ID: "client_1", Slug: "web", ClientID: "shop-web"}}, nil)
	}

	t.Run("a first keyed request stores its record in the write's transaction", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		expectRecord(f, nil)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, app *domain.Application, clients []*domain.ApplicationClient) error {
				app.ID, app.RevisionID, clients[0].ID = "app_1", "apprev_1", "client_1"
				return nil
			},
		)
		f.expectSecrets(1)
		f.tx.EXPECT().CreateApplicationIdempotencyKey(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, got *domain.ApplicationIdempotencyKey) error {
				assert.WithinDuration(t, time.Now(), got.CreatedAt, time.Minute)
				assert.True(t, got.ExpiresAt.Equal(got.CreatedAt.Add(domain.ApplicationIdempotencyKeyTTL)), "the window starts at the first request")
				want := record(document, "client_1")
				want.CreatedAt, want.ExpiresAt = got.CreatedAt, got.ExpiresAt
				assert.Equal(t, want, got)
				return nil
			},
		)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, document, key)
		require.NoError(t, err)
		assert.True(t, got.Created)
		require.Len(t, got.Secrets, 1)
	})

	t.Run("the same key and body rotates the secrets and writes no revision", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		stored := record(document, "client_1")
		expectRecord(f, stored)
		expectReplay(f)
		f.tx.EXPECT().DeleteApplicationClientSecrets(gomock.Any(), appProjectID, "client_1").Return(nil)
		secrets := f.expectSecrets(1)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, document, key)
		require.NoError(t, err)
		assert.True(t, got.Created, "a retry answers with the first request's status")
		assert.Equal(t, "apprev_1", got.Application.RevisionID)
		assert.Equal(t, []service.ApplicationClientSecret{{Slug: "web", ClientID: "shop-web", Secret: "sk_client_1"}}, got.Secrets)
		assert.Equal(t, []*domain.ApplicationClientSecret{
			{ProjectID: appProjectID, ApplicationClientID: "client_1", SecretHash: domain.HashSecret("sk_client_1")},
		}, *secrets)

		require.Len(t, *f.events, 1)
		ev := (*f.events)[0]
		assert.Equal(t, domain.EventTypeApplicationClientSecretRotated, ev.EventType)
		assert.Equal(t, "app_1", *ev.EntityID)
		assert.JSONEq(t, `{"client_ids":["shop-web"],"revision_id":"apprev_1"}`, string(ev.Payload))
	})

	t.Run("a record without clients rotates nothing and emits nothing", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		stored := record(document)
		stored.Created = false
		expectRecord(f, stored)
		expectReplay(f)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, document, key)
		require.NoError(t, err)
		assert.False(t, got.Created)
		assert.Empty(t, got.Secrets)
		assert.Empty(t, *f.events)
	})

	t.Run("another body is refused before the document is validated", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		expectRecord(f, record(document, "client_1"))

		_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, []byte(`{"slug":"shop","name":"Shop","clients":[]}`), key)
		assert.ErrorIs(t, err, domain.ErrApplicationIdempotencyKeyReused())
	})

	t.Run("a refused first request stores no key and returns its own error", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		expectRecord(f, nil).Times(2)

		_, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, []byte(`{"slug":"shop","name":"Shop","clients":[]}`), key)
		assert.ErrorIs(t, err, domain.ErrRequestInvalid())
	})

	t.Run("a write that loses to a request with the same key runs as its retry", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		gomock.InOrder(
			expectRecord(f, nil),
			expectRecord(f, record(document, "client_1")),
		)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
		f.expectLockedRead(storedShop())
		f.tx.EXPECT().ReviseApplication(gomock.Any(), gomock.Any(), gomock.Len(0)).Return(nil)
		f.tx.EXPECT().CreateApplicationIdempotencyKey(gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("application_idempotency_keys", "", nil))
		expectReplay(f)
		f.tx.EXPECT().DeleteApplicationClientSecrets(gomock.Any(), appProjectID, "client_1").Return(nil)
		f.expectSecrets(1)

		got, err := f.svc.CreateOrReviseRegistered(t.Context(), appProjectID, document, key)
		require.NoError(t, err)
		assert.True(t, got.Created)
		require.Len(t, got.Secrets, 1)
		require.Len(t, *f.events, 1, "the revision that lost emitted nothing")
		assert.Equal(t, domain.EventTypeApplicationClientSecretRotated, (*f.events)[0].EventType)
	})
}

func TestApplicationService_Get(t *testing.T) {
	t.Parallel()
	f := newApplicationFixture(t)
	f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

	_, err := f.svc.Get(t.Context(), appProjectID, "app_missing")
	assert.ErrorIs(t, err, domain.ErrApplicationNotFound())
}

func TestApplicationService_List(t *testing.T) {
	t.Parallel()

	col := func(fields ...domain.ApplicationField) []database.Column[domain.ApplicationField] {
		columns := make([]database.Column[domain.ApplicationField], len(fields))
		for i, field := range fields {
			columns[i] = database.Col(field)
		}
		return columns
	}
	tests := []struct {
		name      string
		input     service.ListApplicationsInput
		listErr   error
		wantOrder database.OrderBy[domain.ApplicationField]
		wantLimit uint32
		wantErr   error
	}{
		{
			name:      "no sorting orders by created_at ascending, then id",
			input:     service.ListApplicationsInput{PageToken: "token"},
			wantOrder: database.OrderBy[domain.ApplicationField]{Columns: col(domain.ApplicationFieldCreatedAt, domain.ApplicationFieldID), Direction: database.OrderAsc},
			wantLimit: 20,
		},
		{
			name: "slug equals, a created_at range and a slug sort are accepted",
			input: service.ListApplicationsInput{
				Filters: []service.Filter{{Field: "slug", Operation: "equals", Value: "shop"}, {Field: "created_at", Operation: "greater_than", Value: "2026-01-01T00:00:00Z"}},
				Sorting: &service.Sorting{Field: "slug", Direction: "desc"},
				Limit:   500,
			},
			wantOrder: database.OrderBy[domain.ApplicationField]{Columns: col(domain.ApplicationFieldSlug, domain.ApplicationFieldID), Direction: database.OrderDesc},
			wantLimit: 100,
		},
		{
			name:    "not_equals on slug is not implemented",
			input:   service.ListApplicationsInput{Filters: []service.Filter{{Field: "slug", Operation: "not_equals", Value: "shop"}}},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name:    "a range on slug is invalid",
			input:   service.ListApplicationsInput{Filters: []service.Filter{{Field: "slug", Operation: "less_than", Value: "shop"}}},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name:    "an unknown filter field is invalid",
			input:   service.ListApplicationsInput{Filters: []service.Filter{{Field: "name", Operation: "equals", Value: "Shop"}}},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name:    "an unknown sort field is invalid",
			input:   service.ListApplicationsInput{Sorting: &service.Sorting{Field: "name", Direction: "asc"}},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name:    "a page token issued for another sorting is invalid",
			input:   service.ListApplicationsInput{PageToken: "token"},
			listErr: database.ErrCursorOrderMismatch(),
			wantErr: domain.ErrRequestInvalid(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := newApplicationFixture(t)
			stored := []*domain.Application{{ID: "app_1"}}
			if tt.wantErr == nil || tt.listErr != nil {
				f.pool.EXPECT().ListApplications(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, opts *database.ListOptions[domain.ApplicationField]) (*database.ListResult[*domain.Application], error) {
						if tt.listErr != nil {
							return nil, tt.listErr
						}
						assert.Equal(t, tt.wantOrder, opts.Pagination.OrderBy)
						assert.Equal(t, tt.wantLimit, opts.Pagination.Limit)
						assert.Equal(t, []byte(tt.input.PageToken), opts.Pagination.Cursor)
						return &database.ListResult[*domain.Application]{Items: stored, NextCursor: []byte("next")}, nil
					})
			}
			tt.input.ProjectID = appProjectID
			got, err := f.svc.List(t.Context(), tt.input)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, stored, got.Items)
			assert.Equal(t, "next", got.NextPageToken)
		})
	}
}

func TestApplicationService_Client(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		row      *domain.ApplicationClient
		rowErr   error
		document []byte
		wantErr  error
	}{
		{
			name:     "supplied_client_id",
			row:      &domain.ApplicationClient{ApplicationID: "app_1", Slug: "web", ClientID: "shop-web"},
			document: shopDocument(shopWebFixed),
		},
		{
			// The document holds no client_id when the server generated it, so
			// the client is found through its row.
			name:     "generated_client_id",
			row:      &domain.ApplicationClient{ApplicationID: "app_1", Slug: "web", ClientID: "client_1"},
			document: shopDocument(shopWeb),
		},
		{
			name:    "unknown_client",
			rowErr:  database.NewNoRowFoundError(nil),
			wantErr: domain.ErrApplicationClientNotFound(),
		},
		{
			name:    "storage_unavailable",
			rowErr:  database.NewUnavailableError(nil),
			wantErr: domain.ErrUnavailable(),
		},
		{
			name:     "slug_missing_from_document",
			row:      &domain.ApplicationClient{ApplicationID: "app_1", Slug: "admin", ClientID: "shop-admin"},
			document: shopDocument(shopWebFixed),
			wantErr:  domain.ErrInternal(nil),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := newApplicationFixture(t)
			f.pool.EXPECT().GetApplicationClientByClientID(gomock.Any(), appProjectID, "requested").Return(tt.row, tt.rowErr)
			if tt.row != nil {
				stored := storedShop()
				stored.Document = tt.document
				f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(stored, nil)
			}

			got, err := f.svc.Client(t.Context(), appProjectID, "dep_1", "requested")
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "web", got.Slug)
			assert.Equal(t, []string{"https://shop.example.com/callback"}, got.RedirectURIs)
			assert.Equal(t, []string{"authorization_code"}, got.GrantTypes)
		})
	}
}

// A registered client passes with any of its stored secrets, so it keeps
// working while its secret is rotated.
func TestApplicationService_AuthenticateRegisteredClient(t *testing.T) {
	t.Parallel()
	row := &domain.ApplicationClient{ApplicationID: "app_1", ID: "appcl_1", Slug: "web", ClientID: "shop-web"}
	stored := []*domain.ApplicationClientSecret{
		{ApplicationClientID: "appcl_1", SecretHash: domain.HashSecret("older")},
		{ApplicationClientID: "appcl_1", SecretHash: domain.HashSecret("newer")},
	}
	tests := []struct {
		name       string
		secret     string
		rowErr     error
		secretsErr error
		// document replaces the stored one when set.
		document []byte
		wantErr  error
	}{
		{name: "newest_secret", secret: "newer"},
		{name: "older_secret", secret: "older"},
		{name: "wrong_secret", secret: "wrong", wantErr: domain.ErrApplicationClientSecretInvalid()},
		{name: "empty_secret", wantErr: domain.ErrApplicationClientSecretInvalid()},
		{
			// application.json allows no public client yet; one holds no secret
			// to check.
			name:     "public_client",
			secret:   "newer",
			document: shopDocument(`{"slug":"web","client_id":"shop-web","type":"public","grant_types":["authorization_code"],"redirect_uris":["https://shop.example.com/callback"]}`),
			wantErr:  domain.ErrApplicationClientSecretInvalid(),
		},
		{name: "unknown_client", secret: "newer", rowErr: database.NewNoRowFoundError(nil), wantErr: domain.ErrApplicationClientNotFound()},
		{name: "lookup_unavailable", secret: "newer", rowErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable()},
		{name: "secrets_unavailable", secret: "newer", secretsErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable()},
		{name: "secrets_fail", secret: "newer", secretsErr: errors.New("boom"), wantErr: domain.ErrInternal(nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := newApplicationFixture(t)
			f.pool.EXPECT().GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-web").Return(row, tt.rowErr)
			if tt.rowErr == nil {
				app := storedShop()
				if tt.document != nil {
					app.Document = tt.document
				}
				f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(app, nil)
			}
			if tt.secret != "" && tt.rowErr == nil && tt.document == nil {
				f.pool.EXPECT().ListApplicationClientSecrets(gomock.Any(), appProjectID, "appcl_1").Return(stored, tt.secretsErr)
			}

			// The deployment is not read for a registered client: the strict mock
			// fails on any call it does not expect.
			got, err := f.svc.AuthenticateClient(t.Context(), appProjectID, "dep_1", "shop-web", tt.secret)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "web", got.Document.Slug)
			assert.Equal(t, row, got.Stored)
		})
	}
}

// A declared client is served only by the deployment the caller names. Each
// way that deployment fails to serve it is an answer that means "no", except
// a read that failed.
func TestApplicationService_AuthenticateDeclaredClientRefusals(t *testing.T) {
	t.Parallel()
	deployment := &domain.Deployment{ProjectID: appProjectID, ID: "dep_1", ReleaseID: "rel_1"}
	pinned := &domain.Release{ID: "rel_1", Pointers: []domain.ReleasePointer{{
		Kind: domain.ReleasePointerKindApplication, Handle: "shop", RevisionID: "apprev_1",
	}}}
	tests := []struct {
		name         string
		deploymentID string
		// deploymentErr, release and releaseErr answer the reads of a named
		// deployment.
		deploymentErr error
		release       *domain.Release
		wantErr       error
	}{
		{name: "no_deployment", wantErr: domain.ErrReleaseNotDeployed(nil)},
		// GetDeploymentByID reads within the project, so another project's
		// deployment is not found either.
		{name: "unknown_deployment", deploymentID: "dep_1", deploymentErr: database.NewNoRowFoundError(nil), wantErr: domain.ErrDeploymentNotFound()},
		{name: "deployment_unavailable", deploymentID: "dep_1", deploymentErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable()},
		{name: "deployment_read_fails", deploymentID: "dep_1", deploymentErr: errors.New("boom"), wantErr: domain.ErrInternal(nil)},
		{name: "release_revoked", deploymentID: "dep_1", release: &domain.Release{ID: "rel_1", RevokedAt: new(time.Now()), Pointers: pinned.Pointers}, wantErr: domain.ErrReleaseRevoked()},
		{name: "release_does_not_pin_the_application", deploymentID: "dep_1", release: &domain.Release{ID: "rel_1"}, wantErr: domain.ErrApplicationClientNotFound()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := newApplicationFixture(t)
			f.pool.EXPECT().
				GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-web").
				Return(&domain.ApplicationClient{ApplicationID: "app_1", Slug: "web", ClientID: "shop-web"}, nil)
			f.pool.EXPECT().
				GetApplication(gomock.Any(), gomock.Any()).
				Return(&domain.Application{ProjectID: appProjectID, ID: "app_1", Slug: "shop", IsDeclared: true}, nil)
			if tt.deploymentID != "" {
				f.pool.EXPECT().GetDeploymentByID(gomock.Any(), appProjectID, tt.deploymentID).Return(deployment, tt.deploymentErr)
			}
			if tt.release != nil {
				f.pool.EXPECT().GetReleaseByID(gomock.Any(), appProjectID, "rel_1").Return(tt.release, nil)
			}

			_, err := f.svc.AuthenticateClient(t.Context(), appProjectID, tt.deploymentID, "shop-web", "s3cr3t")
			assert.ErrorIs(t, err, tt.wantErr)
		})
	}
}

func TestApplicationService_ClientUsesDeploymentReleaseForDeclaredApplication(t *testing.T) {
	t.Parallel()
	f := newApplicationFixture(t)
	f.pool.EXPECT().
		GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-web").
		Return(&domain.ApplicationClient{ApplicationID: "app_1", Slug: "web", ClientID: "shop-web"}, nil)
	f.pool.EXPECT().
		GetApplication(gomock.Any(), gomock.Any()).
		Return(&domain.Application{ProjectID: appProjectID, ID: "app_1", Slug: "shop", IsDeclared: true}, nil)
	f.pool.EXPECT().
		GetDeploymentByID(gomock.Any(), appProjectID, "dep_1").
		Return(&domain.Deployment{ProjectID: appProjectID, ID: "dep_1", ReleaseID: "rel_1"}, nil)
	f.pool.EXPECT().
		GetReleaseByID(gomock.Any(), appProjectID, "rel_1").
		Return(&domain.Release{ID: "rel_1", Pointers: []domain.ReleasePointer{{
			Kind: domain.ReleasePointerKindApplication, Handle: "shop", RevisionID: "apprev_1",
		}}}, nil)
	f.pool.EXPECT().
		GetApplicationRevision(gomock.Any(), appProjectID, "apprev_1").
		Return(&domain.Application{
			ProjectID: appProjectID, ID: "app_1", Slug: "shop", IsDeclared: true,
			RevisionID: "apprev_1", Document: shopDocument(shopWebFixed),
		}, nil)

	got, err := f.svc.Client(t.Context(), appProjectID, "dep_1", "shop-web")
	require.NoError(t, err)
	assert.Equal(t, []string{"https://shop.example.com/callback"}, got.RedirectURIs)
}

// A revoked release serves no declared client, whether the lookup loaded the
// deployment's release or the request had resolved it already.
func TestApplicationService_ClientRefusesARevokedRelease(t *testing.T) {
	t.Parallel()
	revoked := &domain.Release{ID: "rel_1", RevokedAt: new(time.Now()), Pointers: []domain.ReleasePointer{{
		Kind: domain.ReleasePointerKindApplication, Handle: "shop", RevisionID: "apprev_1",
	}}}
	deployment := &domain.Deployment{ProjectID: appProjectID, ID: "dep_1", ReleaseID: "rel_1"}
	tests := []struct {
		name     string
		resolved bool
	}{
		{name: "loaded by the lookup"},
		{name: "resolved by the request", resolved: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := newApplicationFixture(t)
			f.pool.EXPECT().
				GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-web").
				Return(&domain.ApplicationClient{ApplicationID: "app_1", Slug: "web", ClientID: "shop-web"}, nil)
			f.pool.EXPECT().
				GetApplication(gomock.Any(), gomock.Any()).
				Return(&domain.Application{ProjectID: appProjectID, ID: "app_1", Slug: "shop", IsDeclared: true}, nil)
			ctx := t.Context()
			if tt.resolved {
				ctx = service.WithRuntimeResolution(ctx, &service.RuntimeResolution{Deployment: deployment, Release: revoked})
			} else {
				f.pool.EXPECT().GetDeploymentByID(gomock.Any(), appProjectID, "dep_1").Return(deployment, nil)
				f.pool.EXPECT().GetReleaseByID(gomock.Any(), appProjectID, "rel_1").Return(revoked, nil)
			}

			_, err := f.svc.Client(ctx, appProjectID, "dep_1", "shop-web")
			assert.ErrorIs(t, err, domain.ErrReleaseRevoked())
		})
	}
}

// applicationFixture splits reads from writes like idpConnectionFixture: the
// service reads through the pool and writes through the transaction, so an
// expectation on the wrong mock fails the test, and an event recorded on tx
// shares the write's transaction.
type applicationFixture struct {
	svc    service.ApplicationService
	pool   *servicemocks.MockAllStatements
	tx     *servicemocks.MockAllStatements
	events *[]*domain.Event
	// eventErr is what the event insert returns; nil records the event.
	eventErr *error
}

func newApplicationFixture(t *testing.T) applicationFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	poolStmts := servicemocks.NewMockAllStatements(ctrl)
	txStmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(poolStmts).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(txStmts).AnyTimes()

	events := new([]*domain.Event)
	eventErr := new(error)
	txStmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			if *eventErr != nil {
				return *eventErr
			}
			*events = append(*events, ev)
			return nil
		},
	).AnyTimes()

	validator, err := domain.NewSchemaValidator("https://example.com/api/schemas")
	require.NoError(t, err)
	return applicationFixture{
		svc:      service.NewApplicationService(service.NewPool(pool), validator, &countingSecrets{}, nil, nil),
		pool:     poolStmts,
		tx:       txStmts,
		events:   events,
		eventErr: eventErr,
	}
}

// expectLockedRead expects revise to lock the application row before it reads
// the newest revision inside the transaction, and serves current from that read.
func (f applicationFixture) expectLockedRead(current *domain.Application) {
	gomock.InOrder(
		f.tx.EXPECT().LockApplication(gomock.Any(), current.ProjectID, current.ID).Return(nil),
		f.tx.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(current, nil),
	)
}

// expectSecrets expects n client secrets stored inside the transaction and
// returns them in the order they were stored.
func (f applicationFixture) expectSecrets(n int) *[]*domain.ApplicationClientSecret {
	secrets := new([]*domain.ApplicationClientSecret)
	f.tx.EXPECT().CreateApplicationClientSecret(gomock.Any(), gomock.Any()).Times(n).DoAndReturn(
		func(_ context.Context, secret *domain.ApplicationClientSecret) error {
			*secrets = append(*secrets, secret)
			return nil
		},
	)
	return secrets
}

// storedShop holds client web with the client_id storage filled in.
func storedShop() *domain.Application {
	return &domain.Application{
		ProjectID:  appProjectID,
		ID:         "app_1",
		Slug:       "shop",
		RevisionID: "apprev_1",
		Document:   shopDocument(shopWebFixed),
		CreatedAt:  time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC),
	}
}

func shopDocument(clients ...string) []byte {
	return []byte(`{"slug":"shop","name":"Shop","clients":[` + strings.Join(clients, ",") + `]}`)
}

// countingSecrets returns sk_<prefix>_1, sk_<prefix>_2, ... so a test can
// tell which client got which secret.
type countingSecrets struct{ n int }

func (g *countingSecrets) New(prefix string) (string, error) {
	g.n++
	return fmt.Sprintf("sk_%s_%d", prefix, g.n), nil
}
