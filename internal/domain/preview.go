package domain

import "time"

// Preview admits one exact URL as a deployment target until it expires. A
// deployment to the URL creates or renews it.
type Preview struct {
	ProjectID string
	Origin    string
	ExpiresAt time.Time
	// CreatedAt is the first deploy to the URL; a renewal keeps it.
	CreatedAt time.Time
}

// PreviewField enumerates the fields of Preview which can be used for
// filtering and ordering in list operations.
type PreviewField uint8

const (
	PreviewFieldUnspecified PreviewField = iota
	PreviewFieldProjectID
	PreviewFieldOrigin
	PreviewFieldExpiresAt
	PreviewFieldCreatedAt
)
