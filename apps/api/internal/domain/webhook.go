package domain

import "time"

// PrefixWebhook is the dialect-minted ID prefix for a project's webhooks
// (hook_<opaque>, ADR 089). The operator's configured sinks keep
// PrefixEventSink.
const PrefixWebhook ResourcePrefix = "hook"

// WebhookErrorCodePrefix starts every webhook error code. The codes are
// webhook.*, not hook.*: the ID prefix is short, the code names the resource
// (ADR 089 §1).
const WebhookErrorCodePrefix = "webhook."

// WebhookProjectLimit is how many webhooks one project holds (ADR 089 §1).
const WebhookProjectLimit = 10

func ErrWebhookInvalid() Error {
	return newError("webhook.invalid", "the webhook request is invalid", nil, nil)
}

func ErrWebhookNotFound() Error {
	return newError("webhook.not_found", "webhook not found", nil, nil)
}

func ErrWebhookPermissionDenied() Error {
	return newError("webhook.permission_denied", "insufficient permissions to manage webhooks", nil, nil)
}

// ErrWebhookLimitReached refuses a create once the project holds
// WebhookProjectLimit webhooks.
func ErrWebhookLimitReached() Error {
	return newError("webhook.limit_reached", "the project has reached its limit of 10 webhooks", nil, nil)
}

// Webhook is a project's webhook (ADR 089 §1). The shipper's configured sinks
// stay [EventSink].
type Webhook struct {
	ID          string
	ProjectID   string
	URL         string
	Description string
	// EventTypes is the filter: event types as GET /events names them, or the
	// single entry "*".
	EventTypes []string
	Enabled    bool
	// Secret and PreviousSecret are the signing secrets as the service layer
	// encrypted them (ADR 089 §3). Storage keeps them as given.
	Secret         string
	PreviousSecret *string
	// PreviousSecretExpiresAt is until when PreviousSecret also signs.
	PreviousSecretExpiresAt *time.Time
	LastDeliveredAt         *time.Time
	LastErrorAt             *time.Time
	// LastErrorStatus is the HTTP status of the last failed attempt, nil when
	// it got no response.
	LastErrorStatus *int32
	// CursorCreatedAt and CursorEventID are the delivery watermark, keyset
	// ordered on an event's (created_at, id) as [EventSinkCursor] is: the
	// project's events after it are still to deliver. They are not on the
	// wire.
	CursorCreatedAt time.Time
	CursorEventID   string
	CreatedAt       time.Time
}

// WebhookUpdate is a partial update of a webhook: a nil field keeps the
// stored value.
type WebhookUpdate struct {
	URL         *string
	Description *string
	EventTypes  []string
	Enabled     *bool
}

// WebhookField enumerates the columns of a webhook that lists filter and
// order on, and whose nullability the schema test checks.
type WebhookField uint8

const (
	WebhookFieldUnspecified WebhookField = iota
	WebhookFieldProjectID
	WebhookFieldID
	WebhookFieldURL
	WebhookFieldDescription
	WebhookFieldEventTypes
	WebhookFieldEnabled
	WebhookFieldSecret
	WebhookFieldPreviousSecret
	WebhookFieldPreviousSecretExpiresAt
	WebhookFieldLastDeliveredAt
	WebhookFieldLastErrorAt
	WebhookFieldLastErrorStatus
	WebhookFieldCursorCreatedAt
	WebhookFieldCursorEventID
	WebhookFieldCreatedAt
)
