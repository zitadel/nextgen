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

// EventSinkCursor is a per-(sink, project) watermark for export (ADR 049).
// Progress is keyset-ordered on (last_created_at, last_event_id).
type EventSinkCursor struct {
	SinkID        string
	ProjectID     string
	LastCreatedAt time.Time
	LastEventID   string
}
