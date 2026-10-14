package domain

// TargetKind is the kind of target a deployment serves: the project's primary
// origins or a preview URL. A variable is stored per kind, and a deployment
// freezes the values of its own kind (ADR 069); nothing falls back from one
// kind to the other.
//
//go:generate go tool enumer -type TargetKind -transform snake -trimprefix TargetKind -sql
type TargetKind uint8

const (
	TargetKindPrimary TargetKind = iota
	TargetKindPreview
)
