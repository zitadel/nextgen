package service_test

import (
	"context"
	"encoding/json"
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

const idpProjectID = "proj_idp"

func googleConnection(issuer, displayName string) []byte {
	return []byte(`{"slug":"google","protocol":"oidc","display_name":"` + displayName + `",` +
		`"oidc":{"issuer":"` + issuer + `","client_id":"id","client_secret":"${{ GOOGLE_SECRET }}","scopes":["openid"]}}`)
}

// withTemplate adds "template":"google" to a connection document.
func withTemplate(document []byte) []byte {
	return append([]byte(`{"template":"google",`), document[1:]...)
}

// idpConnectionFixture splits reads from writes: the service reads through the
// pool and writes through the transaction, so an expectation set on the wrong
// mock fails the test. That is how these tests prove the write and its event
// share one transaction.
type idpConnectionFixture struct {
	svc    service.IDPConnectionService
	pool   *servicemocks.MockAllStatements
	tx     *servicemocks.MockAllStatements
	events *[]*domain.Event
}

func newIDPConnectionFixture(t *testing.T) idpConnectionFixture {
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
	txStmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			*events = append(*events, ev)
			return nil
		},
	).AnyTimes()

	validator, err := domain.NewSchemaValidator("https://example.com/api/schemas")
	require.NoError(t, err)
	return idpConnectionFixture{
		svc:    service.NewIDPConnectionService(service.NewPool(pool), validator),
		pool:   poolStmts,
		tx:     txStmts,
		events: events,
	}
}

func storedGoogleConnection() *domain.IDPConnection {
	return &domain.IDPConnection{
		ProjectID:  idpProjectID,
		ID:         "idp_1",
		Slug:       "google",
		RevisionID: "idprev_1",
		Document:   googleConnection("https://accounts.google.com", "Google"),
		CreatedAt:  time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
	}
}

func TestIDPConnectionService_CreateOrRevise(t *testing.T) {
	t.Parallel()

	t.Run("a new slug creates the connection and emits the snapshot", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		f.tx.EXPECT().CreateIDPConnection(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, c *domain.IDPConnection) error {
				assert.Equal(t, idpProjectID, c.ProjectID)
				assert.Equal(t, "google", c.Slug)
				c.ID, c.RevisionID = "idp_new", "idprev_new"
				return nil
			},
		)

		got, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, googleConnection("https://accounts.google.com", "Google"))
		require.NoError(t, err)
		assert.True(t, got.Created)
		assert.Equal(t, "idp_new", got.Connection.ID)

		require.Len(t, *f.events, 1)
		ev := (*f.events)[0]
		assert.Equal(t, domain.EventTypeIDPCreated, ev.EventType)
		assert.Equal(t, domain.EventCategoryAdmin, ev.Category)
		assert.Equal(t, "idp_connection", *ev.EntityType)
		assert.Equal(t, "idp_new", *ev.EntityID)
		assert.JSONEq(t,
			`{"slug":"google","protocol":"oidc","display_name":"Google","revision_id":"idprev_new"}`,
			string(ev.Payload), "the payload is the allowlist only: no document, no client_secret")
	})

	t.Run("an existing slug appends a revision and emits the delta", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		stored := storedGoogleConnection()
		f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(stored, nil)
		f.tx.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(stored, nil)
		f.tx.EXPECT().ReviseIDPConnection(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, c *domain.IDPConnection) error {
				assert.Equal(t, stored.ID, c.ID)
				assert.Equal(t, stored.CreatedAt, c.CreatedAt)
				c.RevisionID = "idprev_2"
				return nil
			},
		)

		got, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, googleConnection("https://accounts.google.com", "Sign in with Google"))
		require.NoError(t, err)
		assert.False(t, got.Created)
		assert.Equal(t, "idp_1", got.Connection.ID)
		assert.Equal(t, "idprev_2", got.Connection.RevisionID)

		require.Len(t, *f.events, 1)
		ev := (*f.events)[0]
		assert.Equal(t, domain.EventTypeIDPUpdated, ev.EventType)
		assert.Equal(t, "idp_1", *ev.EntityID)
		assert.JSONEq(t, `{"display_name":"Sign in with Google","revision_id":"idprev_2"}`, string(ev.Payload))
	})

	// The stored revision carries a template; the next one either drops it or
	// keeps it. display_name does not change in either case.
	for name, tc := range map[string]struct {
		next []byte
		want string
	}{
		"removing the template sends an empty template": {
			next: googleConnection("https://accounts.google.com", "Google"),
			want: `{"template":"","revision_id":"idprev_2"}`,
		},
		"an unchanged template stays out of the delta": {
			next: withTemplate(googleConnection("https://accounts.google.com", "Google")),
			want: `{"revision_id":"idprev_2"}`,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newIDPConnectionFixture(t)
			stored := storedGoogleConnection()
			stored.Document = withTemplate(stored.Document)
			f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(stored, nil)
			f.tx.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(stored, nil)
			f.tx.EXPECT().ReviseIDPConnection(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, c *domain.IDPConnection) error {
					c.RevisionID = "idprev_2"
					return nil
				},
			)

			_, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, tc.next)
			require.NoError(t, err)
			require.Len(t, *f.events, 1)
			assert.JSONEq(t, tc.want, string((*f.events)[0].Payload))
		})
	}

	// A concurrent revise landed between the slug lookup and the transaction.
	// The delta must compare against the revision read inside the transaction.
	t.Run("the delta is computed against the in-transaction revision", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		stale := storedGoogleConnection()
		stale.Document = googleConnection("https://accounts.google.com", "A")
		current := storedGoogleConnection()
		current.Document = googleConnection("https://accounts.google.com", "B")
		f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(stale, nil)
		f.tx.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(current, nil)
		f.tx.EXPECT().ReviseIDPConnection(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, c *domain.IDPConnection) error {
				c.RevisionID = "idprev_3"
				return nil
			},
		)

		_, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, googleConnection("https://accounts.google.com", "B"))
		require.NoError(t, err)
		require.Len(t, *f.events, 1)
		assert.JSONEq(t, `{"revision_id":"idprev_3"}`, string((*f.events)[0].Payload))
	})

	t.Run("losing the create race revises the connection that won", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		gomock.InOrder(
			f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil)),
			f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(storedGoogleConnection(), nil),
		)
		f.tx.EXPECT().CreateIDPConnection(gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("idp_connections", "idp_connections_slug", nil))
		f.tx.EXPECT().ReviseIDPConnection(gomock.Any(), gomock.Any()).Return(nil)
		f.tx.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(storedGoogleConnection(), nil)

		got, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, googleConnection("https://accounts.google.com", "Google"))
		require.NoError(t, err)
		assert.False(t, got.Created)
		assert.Equal(t, "idp_1", got.Connection.ID)
	})

	t.Run("a revision on the same instant is a conflict", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(storedGoogleConnection(), nil)
		f.tx.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(storedGoogleConnection(), nil)
		f.tx.EXPECT().ReviseIDPConnection(gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("idp_connection_revisions", "idp_connection_revisions_created_at", nil))

		_, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, googleConnection("https://accounts.google.com", "Google"))
		assert.ErrorIs(t, err, domain.ErrIDPConnectionRevisionConflict())
	})

	t.Run("changing identity fields is rejected with every field named", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(storedGoogleConnection(), nil)
		f.tx.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(storedGoogleConnection(), nil)

		next := []byte(`{"slug":"google","protocol":"oidc","display_name":"Google","subject_claim":"oid",` +
			`"oidc":{"issuer":"https://login.example.com","client_id":"id","client_secret":"${{ S }}","scopes":["openid"]}}`)
		_, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, next)
		require.ErrorIs(t, err, domain.ErrIDPConnectionFieldImmutable(nil))
		var domErr domain.Error
		require.ErrorAs(t, err, &domErr)
		assert.Equal(t, map[string][]string{"fields": {"subject_claim", "oidc.issuer"}}, domErr.Details)
		assert.Empty(t, *f.events)
	})

	t.Run("an invalid document stores nothing and names the property", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)

		// protocol oidc without its oidc block
		_, err := f.svc.CreateOrRevise(t.Context(), idpProjectID, []byte(`{"slug":"google","protocol":"oidc","display_name":"Google"}`))
		require.ErrorIs(t, err, domain.ErrRequestInvalid())
		var domErr domain.Error
		require.ErrorAs(t, err, &domErr)
		details, err := json.Marshal(domErr.Details)
		require.NoError(t, err)
		assert.Contains(t, string(details), "oidc")
	})
}

func TestIDPConnectionService_Reads(t *testing.T) {
	t.Parallel()

	t.Run("an unknown connection is not found", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

		_, err := f.svc.Get(t.Context(), idpProjectID, "idp_missing")
		assert.ErrorIs(t, err, domain.ErrIDPConnectionNotFound())
	})

	t.Run("an unknown revision is not found", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		f.pool.EXPECT().GetIDPConnectionRevision(gomock.Any(), idpProjectID, "idprev_missing").Return(nil, database.NewNoRowFoundError(nil))

		_, err := f.svc.GetRevision(t.Context(), idpProjectID, "idprev_missing")
		assert.ErrorIs(t, err, domain.ErrIDPConnectionNotFound())
	})

	// The revisions statement answers an unknown connection with an empty page,
	// so the service has to look the connection up first to answer 404.
	t.Run("the revisions of an unknown connection are not found", func(t *testing.T) {
		t.Parallel()
		f := newIDPConnectionFixture(t)
		f.pool.EXPECT().GetIDPConnection(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

		_, err := f.svc.ListRevisions(t.Context(), service.ListIDPConnectionRevisionsInput{ProjectID: idpProjectID, ID: "idp_missing"})
		assert.ErrorIs(t, err, domain.ErrIDPConnectionNotFound())
	})
}

func TestIDPConnectionService_ListFilters(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   service.ListIDPConnectionsInput
		wantErr error
	}{
		{
			name:  "slug equals and created_at range are accepted",
			input: service.ListIDPConnectionsInput{Filters: []service.Filter{{Field: "slug", Operation: "equals", Value: "google"}, {Field: "created_at", Operation: "greater_than", Value: "2026-01-01T00:00:00Z"}}, Sorting: &service.Sorting{Field: "slug", Direction: "desc"}},
		},
		{
			name:    "not_equals on slug is not implemented",
			input:   service.ListIDPConnectionsInput{Filters: []service.Filter{{Field: "slug", Operation: "not_equals", Value: "google"}}},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name:    "a range on slug is invalid",
			input:   service.ListIDPConnectionsInput{Filters: []service.Filter{{Field: "slug", Operation: "less_than", Value: "google"}}},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name:    "an unknown sort field is invalid",
			input:   service.ListIDPConnectionsInput{Sorting: &service.Sorting{Field: "display_name", Direction: "asc"}},
			wantErr: domain.ErrRequestInvalid(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := newIDPConnectionFixture(t)
			if tt.wantErr == nil {
				f.pool.EXPECT().ListIDPConnections(gomock.Any(), gomock.Any()).
					Return(&database.ListResult[*domain.IDPConnection]{}, nil)
			}
			tt.input.ProjectID = idpProjectID
			_, err := f.svc.List(t.Context(), tt.input)
			if tt.wantErr == nil {
				assert.NoError(t, err)
				return
			}
			assert.ErrorIs(t, err, tt.wantErr)
		})
	}
}
