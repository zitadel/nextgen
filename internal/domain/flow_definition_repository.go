package domain

import "context"

// FlowDefinitionRepository provides storage operations for [FlowDefinition] aggregates.
type FlowDefinitionRepository interface {
	// CreateFlowDefinition persists a new flow definition and all its child
	// records (purposes, audience, steps, transitions) atomically.
	CreateFlowDefinition(ctx context.Context, def *FlowDefinition) error

	// GetFlowDefinition retrieves the full aggregate for a single definition,
	// including its purposes, audience, steps, and transitions.
	GetFlowDefinition(ctx context.Context, projectID, id string) (*FlowDefinition, error)

	// ListFlowDefinitions returns the top-level metadata for all definitions
	// belonging to the given instance. Child records are not populated.
	ListFlowDefinitions(ctx context.Context, projectID string, opts ...FlowDefinitionListOption) ([]*FlowDefinition, error)

	// UpdateFlowDefinitionStatus transitions a definition to the given status.
	UpdateFlowDefinitionStatus(ctx context.Context, projectID, id string, status FlowDefinitionStatus) error

	// DeleteFlowDefinition removes a definition and all its child records.
	DeleteFlowDefinition(ctx context.Context, projectID, id string) error
}

// FlowDefinitionListOption modifies a list query.
type FlowDefinitionListOption func(*FlowDefinitionListOpts)

// FlowDefinitionListOpts holds the resolved options for a list query.
type FlowDefinitionListOpts struct {
	Status  *FlowDefinitionStatus
	Purpose *FlowDefinitionPurpose
	Limit   uint32
	Offset  uint32
}

// ApplyFlowDefinitionListOptions resolves a slice of options into a struct.
func ApplyFlowDefinitionListOptions(opts []FlowDefinitionListOption) *FlowDefinitionListOpts {
	o := &FlowDefinitionListOpts{}
	for _, opt := range opts {
		opt(o)
	}
	return o
}

// WithFlowDefinitionStatus filters results to definitions with the given status.
func WithFlowDefinitionStatus(status FlowDefinitionStatus) FlowDefinitionListOption {
	return func(o *FlowDefinitionListOpts) {
		o.Status = &status
	}
}

// WithFlowDefinitionPurpose filters results to definitions that serve the given purpose.
func WithFlowDefinitionPurpose(purpose FlowDefinitionPurpose) FlowDefinitionListOption {
	return func(o *FlowDefinitionListOpts) {
		o.Purpose = &purpose
	}
}

// WithFlowDefinitionLimit sets the maximum number of results to return.
func WithFlowDefinitionLimit(limit uint32) FlowDefinitionListOption {
	return func(o *FlowDefinitionListOpts) {
		o.Limit = limit
	}
}

// WithFlowDefinitionOffset skips the first n results.
func WithFlowDefinitionOffset(offset uint32) FlowDefinitionListOption {
	return func(o *FlowDefinitionListOpts) {
		o.Offset = offset
	}
}
