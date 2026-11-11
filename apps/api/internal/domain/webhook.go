package domain

// PrefixWebhook is the dialect-minted ID prefix for a project's webhooks
// (hook_<opaque>, ADR 088). The operator's configured sinks keep
// PrefixEventSink.
const PrefixWebhook ResourcePrefix = "hook"

// WebhookErrorCodePrefix starts every webhook error code. The codes are
// webhook.*, not hook.*: the ID prefix is short, the code names the resource
// (ADR 088 §1).
const WebhookErrorCodePrefix = "webhook."

// WebhookProjectLimit is how many webhooks one project holds (ADR 088 §1).
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
