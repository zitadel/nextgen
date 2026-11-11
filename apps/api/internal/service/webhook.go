package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type CreateWebhookInput struct {
	ProjectID   string
	URL         string
	Description string
	EventTypes  []string
}

type ListWebhooksInput struct {
	ProjectID string
	Limit     int
	PageToken string
}

type ListWebhooksOutput struct {
	Items         []*domain.Webhook
	NextPageToken string
}

// WebhookService manages a project's webhooks (ADR 088). It does not deliver:
// the shipper does.
//
// A webhook it returns holds its signing secrets as stored, encrypted. Create
// and RotateSecret also return the new secret in clear, the only time anyone
// sees it; it goes into no event, log or error.
type WebhookService struct {
	v2Pool *DB
	keys   KeyService
}

func NewWebhookService(v2Pool *DB, keys KeyService) *WebhookService {
	return &WebhookService{v2Pool: v2Pool, keys: keys}
}

// Create stores an enabled webhook and returns it with its secret in clear.
func (s *WebhookService) Create(ctx context.Context, in CreateWebhookInput) (_ *domain.Webhook, secret string, err error) {
	ctx, end := startSpan(ctx, "WebhookService.Create")
	defer end(&err)

	if err := validateWebhookURL(in.URL); err != nil {
		return nil, "", err
	}
	if err := validateWebhookEventTypes(in.EventTypes); err != nil {
		return nil, "", err
	}
	secret, encrypted, err := s.newSecret(ctx, in.ProjectID)
	if err != nil {
		return nil, "", err
	}

	var entity *domain.Webhook
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		// Built per call: a Spanner abort replays the callback.
		entity = &domain.Webhook{
			ProjectID:   in.ProjectID,
			URL:         in.URL,
			Description: in.Description,
			EventTypes:  in.EventTypes,
			Secret:      encrypted,
		}
		if err := stmts.CreateWebhook(ctx, entity); err != nil {
			return err
		}
		return emitWebhookEvent(ctx, stmts, domain.EventTypeWebhookCreated, entity, domain.WebhookPayloadSnapshot(entity))
	})
	if err != nil {
		return nil, "", mapWebhookWriteError(err, "failed to create webhook")
	}
	return entity, secret, nil
}

func (s *WebhookService) Get(ctx context.Context, projectID, id string) (_ *domain.Webhook, err error) {
	ctx, end := startSpan(ctx, "WebhookService.Get")
	defer end(&err)

	entity, err := s.v2Pool.Statements().GetWebhook(ctx, projectID, id)
	if err != nil {
		if isNoRowFound(err) {
			return nil, domain.ErrWebhookNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get webhook")
	}
	return entity, nil
}

// List pages the project's webhooks, newest first.
func (s *WebhookService) List(ctx context.Context, in ListWebhooksInput) (_ *ListWebhooksOutput, err error) {
	ctx, end := startSpan(ctx, "WebhookService.List")
	defer end(&err)

	result, err := s.v2Pool.Statements().ListWebhooks(ctx, in.ProjectID, database.Page[domain.WebhookField]{
		Limit:  uint32(normalizeLimit(in.Limit)),
		Cursor: []byte(in.PageToken),
	})
	if err != nil {
		return nil, mapListError(err, "failed to list webhooks")
	}
	return &ListWebhooksOutput{Items: result.Items, NextPageToken: string(result.NextCursor)}, nil
}

// Update writes the fields update names. Enabling a disabled webhook starts
// delivery again from now, which the statement decides.
func (s *WebhookService) Update(ctx context.Context, projectID, id string, update domain.WebhookUpdate) (_ *domain.Webhook, err error) {
	ctx, end := startSpan(ctx, "WebhookService.Update")
	defer end(&err)

	if update.URL == nil && update.Description == nil && update.EventTypes == nil && update.Enabled == nil {
		return nil, domain.ErrWebhookInvalid().WithMessage("webhook: invalid: the update names no field")
	}
	if update.URL != nil {
		if err := validateWebhookURL(*update.URL); err != nil {
			return nil, err
		}
	}
	if update.EventTypes != nil {
		if err := validateWebhookEventTypes(update.EventTypes); err != nil {
			return nil, err
		}
	}

	var entity *domain.Webhook
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		stored, err := stmts.UpdateWebhook(ctx, projectID, id, update)
		if err != nil {
			return err
		}
		entity = stored
		return emitWebhookEvent(ctx, stmts, domain.EventTypeWebhookUpdated, stored, domain.WebhookPayloadDelta(update, stored))
	})
	if err != nil {
		return nil, mapWebhookWriteError(err, "failed to update webhook")
	}
	return entity, nil
}

func (s *WebhookService) Delete(ctx context.Context, projectID, id string) (err error) {
	ctx, end := startSpan(ctx, "WebhookService.Delete")
	defer end(&err)

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.DeleteWebhook(ctx, projectID, id); err != nil {
			return err
		}
		return emitWebhookEvent(ctx, stmts, domain.EventTypeWebhookDeleted, &domain.Webhook{ProjectID: projectID, ID: id}, nil)
	})
	if err != nil {
		return mapWebhookWriteError(err, "failed to delete webhook")
	}
	return nil
}

// RotateSecret issues a new secret and returns the webhook with it in clear.
// The secret it replaces keeps signing for domain.WebhookPreviousSecretTTL;
// the one before that, if a rotation was still in progress, is dropped.
func (s *WebhookService) RotateSecret(ctx context.Context, projectID, id string) (_ *domain.Webhook, secret string, err error) {
	ctx, end := startSpan(ctx, "WebhookService.RotateSecret")
	defer end(&err)

	secret, encrypted, err := s.newSecret(ctx, projectID)
	if err != nil {
		return nil, "", err
	}
	previousExpiresAt := time.Now().Add(domain.WebhookPreviousSecretTTL)

	var entity *domain.Webhook
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		stored, err := stmts.RotateWebhookSecret(ctx, projectID, id, encrypted, previousExpiresAt)
		if err != nil {
			return err
		}
		entity = stored
		return emitWebhookEvent(ctx, stmts, domain.EventTypeWebhookSecretRotated, stored, nil)
	})
	if err != nil {
		return nil, "", mapWebhookWriteError(err, "failed to rotate the webhook secret")
	}
	return entity, secret, nil
}

// newSecret generates a signing secret and encrypts it with the project's
// secret encryption key, the key a secret variable is encrypted with. Every
// project gets that key when it is created, so a project without one is a
// project that does not exist.
func (s *WebhookService) newSecret(ctx context.Context, projectID string) (secret, encrypted string, err error) {
	crypter, err := s.keys.GetProjectCrypter(ctx, projectID, domain.EncryptionKeyPurposeSecret)
	if err != nil {
		if errors.Is(err, domain.ErrEncryptionKeyNotFound()) {
			return "", "", domain.ErrWebhookNotFound().WithParent(err)
		}
		return "", "", err
	}
	secret, err = domain.NewWebhookSecret()
	if err != nil {
		return "", "", domain.ErrInternal(err).WithMessage("failed to generate the webhook secret")
	}
	encrypted, err = crypter.Encrypt(secret)
	if err != nil {
		return "", "", domain.ErrInternal(err).WithMessage("failed to encrypt the webhook secret")
	}
	return secret, encrypted, nil
}

func emitWebhookEvent(ctx context.Context, stmts AllStatements, eventType domain.EventType, entity *domain.Webhook, payload any) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "webhook",
		EntityID:   entity.ID,
		Payload:    payload,
	})
}

// mapWebhookWriteError turns a failed write transaction into the error the
// API answers. project_id is a webhook's only foreign key, so a violation
// means the project was deleted underneath the call, which the access check
// answers as the webhook not being found.
func mapWebhookWriteError(err error, internalMsg string) error {
	if isNoRowFound(err) {
		return domain.ErrWebhookNotFound().WithParent(err)
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return domain.ErrWebhookNotFound().WithParent(err)
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	return domain.ErrInternal(err).WithMessage(internalMsg)
}

// validateWebhookURL refuses what the contract's pattern lets through: a URL
// Go cannot parse, or one it reads no host from. The pattern and length of
// WebhookUrl are the generated validator's.
func validateWebhookURL(raw string) error {
	if u, err := url.Parse(raw); err != nil || u.Hostname() == "" {
		return webhookInvalid("url", "is not a URL with a host")
	}
	return nil
}

// validateWebhookEventTypes refuses what the contract cannot say: "*" beside
// another entry, and an entry that is neither "*" nor a type the server
// writes. The length, uniqueness and shape of the entries are the generated
// validator's.
func validateWebhookEventTypes(eventTypes []string) error {
	if len(eventTypes) == 0 {
		return webhookInvalid("event_types", "holds no entry")
	}
	written := domain.WrittenEventTypes()
	for i, eventType := range eventTypes {
		if eventType == domain.WebhookAllEventTypes {
			if len(eventTypes) > 1 {
				return webhookInvalid("event_types", "lists * beside another entry")
			}
			continue
		}
		if !slices.Contains(written, domain.EventType(eventType)) {
			return webhookInvalid(fmt.Sprintf("event_types[%d]", i), "is not an event type the server writes")
		}
	}
	return nil
}

func webhookInvalid(field, problem string) error {
	return domain.ErrWebhookInvalid().
		WithMessage("webhook: invalid: " + field + " " + problem).
		WithDetails(domain.RequestInvalidFieldDetails{Field: field})
}
