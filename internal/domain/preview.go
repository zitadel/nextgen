package domain

import "time"

// Preview admits one exact URL as a deployment target until it expires. A
// deployment to preview URLs creates or renews the preview of each of them in
// the same operation, so a preview with nothing deployed to it cannot exist.
// Removing or sweeping a preview leaves the deployments to its URL in place.
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
