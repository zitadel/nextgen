package domain

import "time"

const PrefixEventSink ResourcePrefix = "sink"

type EventSinkType string

const (
	EventSinkTypeStdout  EventSinkType = "stdout"
	EventSinkTypeWebhook EventSinkType = "webhook"
)

type EventSinkScope string

const (
	EventSinkScopeDeployment EventSinkScope = "deployment"
	EventSinkScopeProject    EventSinkScope = "project"
)

// EventSink is a first-class export destination (ADR 049).
type EventSink struct {
	ID        string
	Type      EventSinkType
	Scope     EventSinkScope
	ProjectID *string
	URL       string
	Enabled   bool
}

// EventDelivery records at-least-once delivery of an event to a sink.
type EventDelivery struct {
	ProjectID   string
	EventID     string
	SinkID      string
	DeliveredAt time.Time
}
