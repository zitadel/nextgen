package service

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
)

// WebhookDeliveryAdapter implements audit.WebhookSource for the webhook
// shipper (ADR 088 §4), as EventExportAdapter does for the operator's export.
type WebhookDeliveryAdapter struct {
	Pool *DB
	Keys KeyService
	// PlatformProjectID is the deployment's platform project, whose events
	// are visible without a claim (ADR 049 §4); empty when it has none.
	PlatformProjectID string
}

func (a WebhookDeliveryAdapter) LeaseDueWebhooks(ctx context.Context, holder string, dueBy, now, leaseUntil time.Time, limit int) (_ []*domain.Webhook, err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.LeaseDueWebhooks")
	defer end(&err)

	return a.Pool.Statements().LeaseDueWebhooks(ctx, holder, dueBy, now, leaseUntil, uint32(limit))
}

// WebhookEventsVisible is the pre-claim gate of ADR 049 §4 as a project's own
// readers pass it (EventService.projectEventsVisible without an operator): a
// webhook is the project's, not the platform operators', so it gets nothing
// before the claim, and the platform project needs none.
func (a WebhookDeliveryAdapter) WebhookEventsVisible(ctx context.Context, projectID string) (_ bool, err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.WebhookEventsVisible")
	defer end(&err)

	if a.PlatformProjectID != "" && projectID == a.PlatformProjectID {
		return true, nil
	}
	return projectIsClaimed(ctx, a.Pool.Statements(), projectID)
}

func (a WebhookDeliveryAdapter) ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) (_ []*domain.Event, err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.ListEventsAfterCursor")
	defer end(&err)

	return a.Pool.Statements().ListEventsAfterCursor(ctx, projectID, afterCreatedAt, afterID, uint32(limit))
}

// WebhookSecrets decrypts the webhook's signing secret with the key
// WebhookService encrypted it with, and the secret a rotation replaced while
// that one has not expired (ADR 088 §3). The newest secret comes first.
func (a WebhookDeliveryAdapter) WebhookSecrets(ctx context.Context, hook *domain.Webhook, at time.Time) (_ []string, err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.WebhookSecrets")
	defer end(&err)

	crypter, err := a.Keys.GetProjectCrypter(ctx, hook.ProjectID, domain.EncryptionKeyPurposeSecret)
	if err != nil {
		return nil, err
	}
	encrypted := []string{hook.Secret}
	if hook.PreviousSecret != nil && hook.PreviousSecretExpiresAt != nil && hook.PreviousSecretExpiresAt.After(at) {
		encrypted = append(encrypted, *hook.PreviousSecret)
	}
	secrets := make([]string, len(encrypted))
	for i, ciphertext := range encrypted {
		if secrets[i], err = crypter.Decrypt(ciphertext); err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to decrypt the webhook secret")
		}
	}
	return secrets, nil
}

func (a WebhookDeliveryAdapter) RecordWebhookProgress(ctx context.Context, hook *domain.Webhook, holder string, deliveredAt *time.Time) (err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.RecordWebhookProgress")
	defer end(&err)

	return a.Pool.Statements().RecordWebhookProgress(ctx, hook.ProjectID, hook.ID, holder, hook.CursorCreatedAt, hook.CursorEventID, deliveredAt)
}

func (a WebhookDeliveryAdapter) RecordWebhookFailure(ctx context.Context, hook *domain.Webhook, holder string, at time.Time, status *int32, nextAttemptAt time.Time) (err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.RecordWebhookFailure")
	defer end(&err)

	return a.Pool.Statements().RecordWebhookFailure(ctx, hook.ProjectID, hook.ID, holder, at, status, nextAttemptAt)
}

// DisableWebhook disables the webhook and writes webhook.disabled in the
// same transaction, with the system as its actor: no request made the change.
// A webhook that is no longer the holder's, or that the project's admins
// disabled in the meantime, writes neither.
func (a WebhookDeliveryAdapter) DisableWebhook(ctx context.Context, hook *domain.Webhook, holder string, at time.Time, status *int32, reason domain.WebhookDisabledReason) (err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.DisableWebhook")
	defer end(&err)

	return a.Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.DisableFailedWebhook(ctx, hook.ProjectID, hook.ID, holder, at, status); err != nil {
			return err
		}
		system := domain.EventActorTypeSystem
		return audit.Emit(ctx, stmts, audit.EmitSpec{
			Type:       domain.EventTypeWebhookDisabled,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  hook.ProjectID,
			EntityType: "webhook",
			EntityID:   hook.ID,
			Payload:    domain.WebhookDisabledPayload{Reason: reason},
			ActorType:  &system,
		})
	})
}

func (a WebhookDeliveryAdapter) ReleaseWebhookLease(ctx context.Context, hook *domain.Webhook, holder string, nextAttemptAt time.Time) (err error) {
	ctx, end := startSpan(ctx, "WebhookDeliveryAdapter.ReleaseWebhookLease")
	defer end(&err)

	return a.Pool.Statements().ReleaseWebhookLease(ctx, hook.ProjectID, hook.ID, holder, nextAttemptAt)
}

var _ audit.WebhookSource = WebhookDeliveryAdapter{}
