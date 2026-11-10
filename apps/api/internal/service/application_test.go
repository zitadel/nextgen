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
				assert.Equal(t, domain.HashSecret("sk_client_1"), clients[0].SecretHash)
				assert.Equal(t, domain.HashSecret("sk_client_2"), clients[1].SecretHash)
				app.ID, app.RevisionID = "app_1", "apprev_1"
				clients[0].ClientID = "client_1"
				return nil
			},
		)

		got, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWeb, shopAdmin))
		require.NoError(t, err)
		assert.True(t, got.Created)
		assert.Equal(t, "app_1", got.Application.ID)
		assert.Equal(t, []service.ApplicationClientSecret{
			{Slug: "web", ClientID: "client_1", Secret: "sk_client_1"},
			{Slug: "admin", ClientID: "shop-admin", Secret: "sk_client_2"},
		}, got.Secrets)

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
				return nil
			},
		)

		got, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWeb, shopAdmin))
		require.NoError(t, err)
		assert.False(t, got.Created)
		assert.Equal(t, []service.ApplicationClientSecret{{Slug: "admin", ClientID: "shop-admin", Secret: "sk_client_1"}}, got.Secrets)

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

		got, err := f.svc.CreateOrRevise(t.Context(), appProjectID, []byte(`{"slug":"shop","name":"Shop 2","clients":[`+shopWeb+`]}`))
		require.NoError(t, err)
		assert.Nil(t, got.Secrets)

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

		got, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWebFixed))
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

		_, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWebFixed))
		assert.ErrorIs(t, err, domain.ErrApplicationClientIDTaken())
	})

	t.Run("a revision whose new client_id another client holds is client_id_taken", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
		f.expectLockedRead(storedShop())
		f.tx.EXPECT().ReviseApplication(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("application_clients", "application_clients_client_id", nil))
		f.pool.EXPECT().GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-admin").
			Return(&domain.ApplicationClient{ApplicationID: "app_other", ClientID: "shop-admin"}, nil)

		_, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWeb, shopAdmin))
		assert.ErrorIs(t, err, domain.ErrApplicationClientIDTaken())
	})

	t.Run("a revision on the same instant is a conflict", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
		f.expectLockedRead(storedShop())
		f.tx.EXPECT().ReviseApplication(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("application_revisions", "application_revisions_created_at", nil))
		f.pool.EXPECT().GetApplicationClientByClientID(gomock.Any(), appProjectID, "shop-admin").
			Return(nil, database.NewNoRowFoundError(nil))

		_, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWeb, shopAdmin))
		assert.ErrorIs(t, err, domain.ErrApplicationRevisionConflict())
	})

	t.Run("an event the store refuses fails the create and returns no secret", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		*f.eventErr = errors.New("event insert failed")
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)

		got, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWeb))
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
		assert.Nil(t, got, "a secret for a write that rolled back would never work")
	})

	t.Run("a project deleted before the create is not found", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		f.tx.EXPECT().CreateApplication(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(database.NewForeignKeyError("applications", "fk_applications_project", nil))

		_, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWeb))
		assert.ErrorIs(t, err, domain.ErrApplicationNotFound())
	})

	t.Run("an application gone before the lock is not found", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)
		f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(storedShop(), nil)
		f.tx.EXPECT().LockApplication(gomock.Any(), appProjectID, "app_1").Return(database.NewNoRowFoundError(nil))

		_, err := f.svc.CreateOrRevise(t.Context(), appProjectID, shopDocument(shopWeb))
		assert.ErrorIs(t, err, domain.ErrApplicationNotFound())
	})

	t.Run("a document the schema refuses stores nothing", func(t *testing.T) {
		t.Parallel()
		f := newApplicationFixture(t)

		_, err := f.svc.CreateOrRevise(t.Context(), appProjectID, []byte(`{"slug":"shop","name":"Shop","clients":[]}`))
		assert.ErrorIs(t, err, domain.ErrRequestInvalid())
	})
}

func TestApplicationService_Get(t *testing.T) {
	t.Parallel()
	f := newApplicationFixture(t)
	f.pool.EXPECT().GetApplication(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

	_, err := f.svc.Get(t.Context(), appProjectID, "app_missing")
	assert.ErrorIs(t, err, domain.ErrApplicationNotFound())
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
		svc:      service.NewApplicationService(service.NewPool(pool), validator, &countingSecrets{}),
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
