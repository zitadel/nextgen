package service_test

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type webhookFixture struct {
	svc        *service.WebhookService
	statements *servicemocks.MockAllStatements
	keys       *servicemocks.MockKeyService
	ctrl       *gomock.Controller
	events     []*domain.Event
	// encrypted is every plaintext the project's crypter was handed.
	encrypted []string
}

func newWebhookFixture(t *testing.T) *webhookFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()

	keys := servicemocks.NewMockKeyService(ctrl)
	f := &webhookFixture{svc: service.NewWebhookService(service.NewPool(pool), keys), statements: statements, keys: keys, ctrl: ctrl}
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
		f.events = append(f.events, ev)
		return nil
	}).AnyTimes()
	return f
}

// expectEncryption has the project's secret key encrypt once, to "ciphertext".
func (f *webhookFixture) expectEncryption() {
	crypter := cryptomock.NewMockCrypter(f.ctrl)
	crypter.EXPECT().Encrypt(gomock.Any()).DoAndReturn(func(plain string) (string, error) {
		f.encrypted = append(f.encrypted, plain)
		return "ciphertext", nil
	})
	f.keys.EXPECT().GetProjectCrypter(gomock.Any(), "proj_1", domain.EncryptionKeyPurposeSecret).Return(crypter, nil)
}

func (f *webhookFixture) create(url string, eventTypes ...string) (*domain.Webhook, string, error) {
	return f.svc.Create(context.Background(), service.CreateWebhookInput{
		ProjectID:   "proj_1",
		URL:         url,
		Description: "User sync",
		EventTypes:  eventTypes,
	})
}

// requireWebhookSecret checks the shape ADR 090 §3 gives a secret: whsec_ and
// the base64 of 32 bytes.
func requireWebhookSecret(t *testing.T, secret string) {
	t.Helper()
	encoded, ok := strings.CutPrefix(secret, "whsec_")
	require.True(t, ok, "the secret starts with whsec_")
	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)
	require.Len(t, raw, 32)
}

// requireNoSecret fails when an event the fixture recorded holds a secret,
// in clear or as stored.
func (f *webhookFixture) requireNoSecret(t *testing.T, secrets ...string) {
	t.Helper()
	for _, ev := range f.events {
		recorded := string(ev.Payload) + string(ev.Metadata)
		assert.NotContains(t, recorded, "secret")
		for _, secret := range append(secrets, "ciphertext") {
			assert.NotContains(t, recorded, secret)
		}
	}
}

func TestWebhookService_Create(t *testing.T) {
	f := newWebhookFixture(t)
	f.expectEncryption()
	f.statements.EXPECT().CreateWebhook(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, w *domain.Webhook) error {
		assert.Equal(t, "ciphertext", w.Secret, "the secret is stored encrypted")
		w.ID, w.Enabled = "hook_1", true
		return nil
	})

	got, secret, err := f.create("https://api.acme.com/hooks/zitadel?token=t0p#frag", "user.created", "request.api")
	require.NoError(t, err)
	assert.Equal(t, "hook_1", got.ID)
	requireWebhookSecret(t, secret)
	assert.Equal(t, []string{secret}, f.encrypted, "the secret returned is the one encrypted")

	require.Len(t, f.events, 1)
	ev := f.events[0]
	assert.Equal(t, domain.EventTypeWebhookCreated, ev.EventType)
	assert.Equal(t, domain.EventCategoryAdmin, ev.Category)
	assert.Equal(t, "webhook", *ev.EntityType)
	assert.Equal(t, "hook_1", *ev.EntityID)
	assert.JSONEq(t, `{
		"url": "https://api.acme.com/hooks/zitadel",
		"description": "User sync",
		"event_types": ["user.created", "request.api"],
		"enabled": true
	}`, string(ev.Payload))
	f.requireNoSecret(t, secret)
}

func TestWebhookService_CreateAcceptsEveryType(t *testing.T) {
	f := newWebhookFixture(t)
	f.expectEncryption()
	f.statements.EXPECT().CreateWebhook(gomock.Any(), gomock.Any()).Return(nil)

	_, _, err := f.create("https://api.acme.com/hooks", "*")
	require.NoError(t, err)
}

func TestWebhookService_InvalidIsRefusedBeforeKeysAndStorage(t *testing.T) {
	f := newWebhookFixture(t) // no expectations: nothing may be read, encrypted or written
	for _, tt := range []struct {
		name       string
		url        string
		eventTypes []string
		field      string
	}{
		{"star beside another entry", "https://a.example", []string{"*", "user.created"}, "event_types"},
		{"a type the server does not know", "https://a.example", []string{"user.created", "user.exploded"}, "event_types[1]"},
		// Retired: the constant stays so stored rows decode, and nothing writes it.
		{"a retired type", "https://a.example", []string{string(domain.EventTypeFlowdefUpdated)}, "event_types[0]"},
		{"no entry", "https://a.example", nil, "event_types"},
		{"a url Go cannot parse", "https://a.example:port/hook", []string{"*"}, "url"},
		{"a url without a host", "https://:443/hook", []string{"*"}, "url"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := f.create(tt.url, tt.eventTypes...)
			requireWebhookInvalid(t, err, tt.field)

			if tt.eventTypes == nil {
				return // an update that names no event_types leaves them alone
			}
			_, err = f.svc.Update(context.Background(), "proj_1", "hook_1", domain.WebhookUpdate{URL: &tt.url, EventTypes: tt.eventTypes})
			requireWebhookInvalid(t, err, tt.field)
		})
	}

	t.Run("an update that names no field", func(t *testing.T) {
		_, err := f.svc.Update(context.Background(), "proj_1", "hook_1", domain.WebhookUpdate{})
		require.ErrorIs(t, err, domain.ErrWebhookInvalid())
	})
	assert.Empty(t, f.events)
}

func requireWebhookInvalid(t *testing.T, err error, field string) {
	t.Helper()
	require.ErrorIs(t, err, domain.ErrWebhookInvalid())
	var de domain.Error
	require.ErrorAs(t, err, &de)
	assert.Equal(t, domain.RequestInvalidFieldDetails{Field: field}, de.Details)
}

func TestWebhookService_CreateErrors(t *testing.T) {
	for _, tt := range []struct {
		name      string
		storage   error
		want      domain.Error
		wantFault bool
	}{
		{name: "the limit passes through", storage: domain.ErrWebhookLimitReached(), want: domain.ErrWebhookLimitReached()},
		{name: "a project deleted underneath", storage: database.NewForeignKeyError("", "", nil), want: domain.ErrWebhookNotFound()},
		{name: "anything else is a server fault", storage: errors.New("connection reset"), wantFault: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := newWebhookFixture(t)
			f.expectEncryption()
			f.statements.EXPECT().CreateWebhook(gomock.Any(), gomock.Any()).Return(tt.storage)

			_, secret, err := f.create("https://a.example", "*")
			require.Error(t, err)
			assert.Empty(t, secret)
			assert.Equal(t, tt.wantFault, domain.IsServerFault(err))
			if !tt.wantFault {
				require.ErrorIs(t, err, tt.want)
			}
			assert.NotContains(t, err.Error(), f.encrypted[0], "an error never carries the secret")
			assert.Empty(t, f.events, "a failed write records nothing")
		})
	}

	t.Run("a project without a secret key does not exist", func(t *testing.T) {
		f := newWebhookFixture(t)
		f.keys.EXPECT().GetProjectCrypter(gomock.Any(), "proj_1", domain.EncryptionKeyPurposeSecret).
			Return(nil, domain.ErrEncryptionKeyNotFound())

		_, _, err := f.create("https://a.example", "*")
		require.ErrorIs(t, err, domain.ErrWebhookNotFound())
	})
}

func TestWebhookService_UpdateRecordsTheNamedFields(t *testing.T) {
	f := newWebhookFixture(t)
	update := domain.WebhookUpdate{URL: new("https://b.example/hook?key=k"), Description: new(""), Enabled: new(false)}
	f.statements.EXPECT().UpdateWebhook(gomock.Any(), "proj_1", "hook_1", update).Return(&domain.Webhook{
		ProjectID:  "proj_1",
		ID:         "hook_1",
		URL:        "https://b.example/hook?key=k",
		EventTypes: []string{"user.created"},
		Secret:     "ciphertext",
	}, nil)

	got, err := f.svc.Update(context.Background(), "proj_1", "hook_1", update)
	require.NoError(t, err)
	assert.Equal(t, "https://b.example/hook?key=k", got.URL)

	require.Len(t, f.events, 1)
	assert.Equal(t, domain.EventTypeWebhookUpdated, f.events[0].EventType)
	assert.Equal(t, "hook_1", *f.events[0].EntityID)
	// event_types was not named, so it is absent; the emptied description
	// and the false are new values, so they are present.
	assert.JSONEq(t, `{"url": "https://b.example/hook", "description": "", "enabled": false}`, string(f.events[0].Payload))
	f.requireNoSecret(t)
}

func TestWebhookService_Delete(t *testing.T) {
	f := newWebhookFixture(t)
	f.statements.EXPECT().DeleteWebhook(gomock.Any(), "proj_1", "hook_1").Return(nil)

	require.NoError(t, f.svc.Delete(context.Background(), "proj_1", "hook_1"))
	require.Len(t, f.events, 1)
	assert.Equal(t, domain.EventTypeWebhookDeleted, f.events[0].EventType)
	assert.Equal(t, "hook_1", *f.events[0].EntityID)
	assert.JSONEq(t, `{}`, string(f.events[0].Payload))
}

func TestWebhookService_RotateSecret(t *testing.T) {
	f := newWebhookFixture(t)
	f.expectEncryption()
	before := time.Now()
	f.statements.EXPECT().RotateWebhookSecret(gomock.Any(), "proj_1", "hook_1", "ciphertext", gomock.Any()).DoAndReturn(
		func(_ context.Context, projectID, id, _ string, previousExpiresAt time.Time) (*domain.Webhook, error) {
			assert.WithinRange(t, previousExpiresAt, before.Add(domain.WebhookPreviousSecretTTL), time.Now().Add(domain.WebhookPreviousSecretTTL))
			return &domain.Webhook{
				ProjectID:               projectID,
				ID:                      id,
				Secret:                  "ciphertext",
				PreviousSecret:          new("older ciphertext"),
				PreviousSecretExpiresAt: &previousExpiresAt,
			}, nil
		})

	got, secret, err := f.svc.RotateSecret(context.Background(), "proj_1", "hook_1")
	require.NoError(t, err)
	require.NotNil(t, got.PreviousSecretExpiresAt)
	requireWebhookSecret(t, secret)
	assert.Equal(t, []string{secret}, f.encrypted)
	assert.Equal(t, 24*time.Hour, domain.WebhookPreviousSecretTTL)

	require.Len(t, f.events, 1)
	assert.Equal(t, domain.EventTypeWebhookSecretRotated, f.events[0].EventType)
	assert.JSONEq(t, `{}`, string(f.events[0].Payload))
	f.requireNoSecret(t, secret)
}

// A webhook the project does not hold is webhook.not_found on every path
// that addresses one, and a write that found none records nothing.
func TestWebhookService_NotFound(t *testing.T) {
	f := newWebhookFixture(t)
	f.expectEncryption()
	noRow := database.NewNoRowFoundError(nil)
	f.statements.EXPECT().GetWebhook(gomock.Any(), "proj_1", "hook_x").Return(nil, noRow)
	f.statements.EXPECT().UpdateWebhook(gomock.Any(), "proj_1", "hook_x", gomock.Any()).Return(nil, noRow)
	f.statements.EXPECT().DeleteWebhook(gomock.Any(), "proj_1", "hook_x").Return(noRow)
	f.statements.EXPECT().RotateWebhookSecret(gomock.Any(), "proj_1", "hook_x", gomock.Any(), gomock.Any()).Return(nil, noRow)

	ctx := context.Background()
	_, err := f.svc.Get(ctx, "proj_1", "hook_x")
	require.ErrorIs(t, err, domain.ErrWebhookNotFound())
	_, err = f.svc.Update(ctx, "proj_1", "hook_x", domain.WebhookUpdate{Enabled: new(true)})
	require.ErrorIs(t, err, domain.ErrWebhookNotFound())
	require.ErrorIs(t, f.svc.Delete(ctx, "proj_1", "hook_x"), domain.ErrWebhookNotFound())
	_, _, err = f.svc.RotateSecret(ctx, "proj_1", "hook_x")
	require.ErrorIs(t, err, domain.ErrWebhookNotFound())
	assert.Empty(t, f.events)
}

func TestWebhookService_List(t *testing.T) {
	f := newWebhookFixture(t)
	f.statements.EXPECT().ListWebhooks(gomock.Any(), "proj_1", database.Page[domain.WebhookField]{Limit: 2, Cursor: []byte("cursor")}).
		Return(&database.ListResult[*domain.Webhook]{Items: []*domain.Webhook{{ID: "hook_1"}}, NextCursor: []byte("next")}, nil)

	got, err := f.svc.List(context.Background(), service.ListWebhooksInput{ProjectID: "proj_1", Limit: 2, PageToken: "cursor"})
	require.NoError(t, err)
	require.Len(t, got.Items, 1)
	assert.Equal(t, "next", got.NextPageToken)
}
