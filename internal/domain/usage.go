package domain

import (
	"encoding/json"
	"time"
)

// PrefixUsage only namespaces the error codes below: no resource is minted
// under it.
const PrefixUsage ResourcePrefix = "usage"

func ErrUsageNotFound() Error {
	return newError(PrefixUsage.ErrorCodePrefix("not_found"), "usage: project not found", nil, nil)
}

func ErrUsagePermissionDenied() Error {
	return newError(PrefixUsage.ErrorCodePrefix("permission_denied"), "usage: permission denied", nil, nil)
}

func ErrUsageInvalid(details any) Error {
	return newError(PrefixUsage.ErrorCodePrefix("invalid"), "usage: invalid request", details, nil)
}

// ErrUsageDisabled answers a deployment that counts no usage (usage.enabled
// is off).
func ErrUsageDisabled() Error {
	return newError(PrefixUsage.ErrorCodePrefix("disabled"), "usage: this deployment does not count usage", nil, nil)
}

// UsageMeter is a count the server keeps per project and UTC hour (ADR 085
// §1). Every meter so far counts users: a user counts once a month, in the
// hour of their first event of the meter's types that month, so a month's
// hours add up to its count.
type UsageMeter struct {
	// Name is the meter's id on the wire, in the hosted cloud's catalog and as
	// its Stripe meter's event name.
	Name string
	// EventTypes are the events it counts.
	EventTypes []EventType
	// User names the user an event counts, or "" when the event counts none.
	User func(*Event) string
}

// MeterMonthlyActiveUsers counts the users who established a session.
const MeterMonthlyActiveUsers = "monthly_active_users"

// UsageMeters are the meters the server keeps.
var UsageMeters = []UsageMeter{
	{
		Name:       MeterMonthlyActiveUsers,
		EventTypes: []EventType{EventTypeSessionEstablished},
		// Every auth.token.issued that names a user is minted in the
		// transaction that establishes its session, so session.established
		// alone counts them.
		User: payloadUserID,
	},
}

// UsageMeterByName returns the meter called name.
func UsageMeterByName(name string) (UsageMeter, bool) {
	for _, meter := range UsageMeters {
		if meter.Name == name {
			return meter, true
		}
	}
	return UsageMeter{}, false
}

// payloadUserID reads `user_id` from an event's payload, which
// session.established carries when the session has a user.
func payloadUserID(event *Event) string {
	var payload struct {
		UserID string `json:"user_id"`
	}
	if json.Unmarshal(event.Payload, &payload) != nil {
		return ""
	}
	return payload.UserID
}

// UsageCursor is how far the usage projector has counted a project's events:
// every event stamped before CountedBefore is counted. With LastEventID it is
// also where the next read starts, after (CountedBefore, LastEventID) on
// (created_at, id). LastEventID is empty when the cursor sits on a settled
// bound rather than on an event.
type UsageCursor struct {
	ProjectID     string
	CountedBefore time.Time
	LastEventID   string
}

// UsageTouch is a user a batch of events names for a meter: they count in
// Hour, the hour of their first such event in the batch, unless the meter
// counted them earlier in Month.
type UsageTouch struct {
	Meter  string
	Month  time.Time
	UserID string
	Hour   time.Time
}

// UsageHour is one meter's count in one UTC hour.
type UsageHour struct {
	Meter string
	Hour  time.Time
	Value int64
}

// UsageMonth is the start of t's UTC month.
func UsageMonth(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// UsageHourOf is the start of t's UTC hour.
func UsageHourOf(t time.Time) time.Time {
	return t.UTC().Truncate(time.Hour)
}
