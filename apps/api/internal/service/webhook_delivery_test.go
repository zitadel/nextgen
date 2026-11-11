package service_test

import (
	"context"
	"encoding/json"
	"errors"
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

type webhookDeliveryFixture struct {
	adapter    service.WebhookDeliveryAdapter
	statements *servicemocks.MockAllStatements
	keys       *servicemocks.MockKeyService
	ctrl       *gomock.Controller
	// inTransaction is true while the pool's transaction callback runs.
	inTransaction bool
}

func newWebhookDeliveryFixture(t *testing.T) *webhookDeliveryFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	keys := servicemocks.NewMockKeyService(ctrl)
	f := &webhookDeliveryFixture{statements: statements, keys: keys, ctrl: ctrl}
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			f.inTransaction = true
			defer func() { f.inTransaction = false }()
			return fn(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	f.adapter = service.WebhookDeliveryAdapter{Pool: service.NewPool(pool), Keys: keys, PlatformProjectID: "proj_platform"}
	return f
}

// expectDecryption has the project's secret key, the one WebhookService
// encrypts with, decrypt "enc:<x>" to "<x>".
func (f *webhookDeliveryFixture) expectDecryption() {
	crypter := cryptomock.NewMockCrypter(f.ctrl)
	crypter.EXPECT().Decrypt(gomock.Any()).DoAndReturn(func(encrypted string) (string, error) {
		if len(encrypted) < 4 || encrypted[:4] != "enc:" {
			return "", errors.New("cipher: message authentication failed")
		}
		return encrypted[4:], nil
	}).AnyTimes()
	f.keys.EXPECT().GetProjectCrypter(gomock.Any(), "proj_1", domain.EncryptionKeyPurposeSecret).Return(crypter, nil)
}

// A delivery is signed with the webhook's secret, and also with the one a
// rotation replaced until that one expires (ADR 089 §3).
func TestWebhookDeliveryAdapter_WebhookSecrets(t *testing.T) {
	at := time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		hook domain.Webhook
		want []string
	}{
		{"never rotated", domain.Webhook{Secret: "enc:whsec_new"}, []string{"whsec_new"}},
		{"inside the rotation window",
			domain.Webhook{Secret: "enc:whsec_new", PreviousSecret: new("enc:whsec_old"), PreviousSecretExpiresAt: new(at.Add(time.Second))},
			[]string{"whsec_new", "whsec_old"}},
		{"as the window ends",
			domain.Webhook{Secret: "enc:whsec_new", PreviousSecret: new("enc:whsec_old"), PreviousSecretExpiresAt: new(at)},
			[]string{"whsec_new"}},
		{"after the window",
			domain.Webhook{Secret: "enc:whsec_new", PreviousSecret: new("enc:whsec_old"), PreviousSecretExpiresAt: new(at.Add(-time.Hour))},
			[]string{"whsec_new"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWebhookDeliveryFixture(t)
			f.expectDecryption()
			tc.hook.ProjectID = "proj_1"

			got, err := f.adapter.WebhookSecrets(t.Context(), &tc.hook, at)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

// A secret that cannot be decrypted is an error, the previous one's too:
// the caller fails the delivery rather than sign with less (ADR 089 §3).
func TestWebhookDeliveryAdapter_WebhookSecretsFailsOnAnUnreadableSecret(t *testing.T) {
	at := time.Now()
	for name, hook := range map[string]domain.Webhook{
		"the secret":   {Secret: "garbled"},
		"the previous": {Secret: "enc:whsec_new", PreviousSecret: new("garbled"), PreviousSecretExpiresAt: new(at.Add(time.Hour))},
	} {
		t.Run(name, func(t *testing.T) {
			f := newWebhookDeliveryFixture(t)
			f.expectDecryption()
			hook.ProjectID = "proj_1"

			got, err := f.adapter.WebhookSecrets(t.Context(), &hook, at)
			require.Error(t, err)
			assert.Nil(t, got)
			assert.NotContains(t, err.Error(), "whsec_")
		})
	}

	t.Run("no key", func(t *testing.T) {
		f := newWebhookDeliveryFixture(t)
		f.keys.EXPECT().GetProjectCrypter(gomock.Any(), "proj_1", domain.EncryptionKeyPurposeSecret).Return(nil, domain.ErrEncryptionKeyNotFound())
		_, err := f.adapter.WebhookSecrets(t.Context(), &domain.Webhook{ProjectID: "proj_1", Secret: "enc:whsec_new"}, at)
		require.ErrorIs(t, err, domain.ErrEncryptionKeyNotFound())
	})
}

// The pre-claim gate as a project's own readers pass it (ADR 049 §4):
// nothing before the claim, and the platform project needs none.
func TestWebhookDeliveryAdapter_WebhookEventsVisible(t *testing.T) {
	noRow := database.NewNoRowFoundError(nil)
	for _, tc := range []struct {
		name      string
		projectID string
		expect    func(*servicemocks.MockAllStatements)
		want      bool
	}{
		{"the platform project, without a read", "proj_platform", func(*servicemocks.MockAllStatements) {}, true},
		{"claimed", "proj_1", func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
			s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{}, nil)
		}, true},
		{"unclaimed", "proj_1", func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
			s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, noRow)
		}, false},
		{"gone", "proj_1", func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(nil, noRow)
		}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWebhookDeliveryFixture(t)
			tc.expect(f.statements)

			got, err := f.adapter.WebhookEventsVisible(t.Context(), tc.projectID)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}

	t.Run("a failed read is an error, not hidden", func(t *testing.T) {
		f := newWebhookDeliveryFixture(t)
		f.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(nil, errors.New("failed to connect"))
		_, err := f.adapter.WebhookEventsVisible(t.Context(), "proj_1")
		require.Error(t, err)
	})
}

// Disabling a webhook and its webhook.disabled event are one transaction,
// and the event says why, with the system as its actor (ADR 089 §4).
func TestWebhookDeliveryAdapter_DisableWebhookWritesItsEvent(t *testing.T) {
	at := time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)
	hook := &domain.Webhook{ProjectID: "proj_1", ID: "hook_1", Secret: "enc:whsec_new", URL: "https://api.acme.com/hooks?token=t0p"}
	for _, reason := range []domain.WebhookDisabledReason{domain.WebhookDisabledReasonGone, domain.WebhookDisabledReasonFailing} {
		t.Run(string(reason), func(t *testing.T) {
			f := newWebhookDeliveryFixture(t)
			var events []*domain.Event
			f.statements.EXPECT().DisableFailedWebhook(gomock.Any(), "proj_1", "hook_1", "server-a", at, new(int32(410))).DoAndReturn(
				func(context.Context, string, string, string, time.Time, *int32) error {
					assert.True(t, f.inTransaction)
					return nil
				})
			f.statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
				assert.True(t, f.inTransaction)
				events = append(events, ev)
				return nil
			})

			require.NoError(t, f.adapter.DisableWebhook(t.Context(), hook, "server-a", at, new(int32(410)), reason))

			require.Len(t, events, 1)
			ev := events[0]
			assert.Equal(t, domain.EventTypeWebhookDisabled, ev.EventType)
			assert.Equal(t, domain.EventCategoryAdmin, ev.Category)
			assert.Equal(t, "proj_1", ev.ProjectID)
			assert.Equal(t, new("webhook"), ev.EntityType)
			assert.Equal(t, new("hook_1"), ev.EntityID)
			assert.Equal(t, new(domain.EventActorTypeSystem), ev.ActorType)
			assert.JSONEq(t, `{"reason":"`+string(reason)+`"}`, string(ev.Payload))
			var payload map[string]any
			require.NoError(t, json.Unmarshal(ev.Payload, &payload))
			assert.Len(t, payload, 1, "the reason and nothing else: no url, no secret")
		})
	}
}

// A webhook the server no longer holds, or that was disabled meanwhile, is
// not disabled a second time: no event without the write.
func TestWebhookDeliveryAdapter_DisableWebhookWritesNoEventWithoutTheWrite(t *testing.T) {
	f := newWebhookDeliveryFixture(t)
	noRow := database.NewNoRowFoundError(nil)
	f.statements.EXPECT().DisableFailedWebhook(gomock.Any(), "proj_1", "hook_1", "server-a", gomock.Any(), gomock.Nil()).Return(noRow)

	err := f.adapter.DisableWebhook(t.Context(), &domain.Webhook{ProjectID: "proj_1", ID: "hook_1"}, "server-a", time.Now(), nil, domain.WebhookDisabledReasonFailing)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
