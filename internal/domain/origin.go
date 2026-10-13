package domain

// OriginKind says what an origin pattern is for. A primary pattern admits
// requests from the URLs it matches; a preview pattern only bounds which URLs
// a preview deploy may register, and a request from such a URL is admitted by
// its [Preview] row alone.
//
//go:generate go tool enumer -type OriginKind -transform snake -trimprefix OriginKind -sql
type OriginKind uint8

const (
	OriginKindPrimary OriginKind = iota
	OriginKindPreview
)
