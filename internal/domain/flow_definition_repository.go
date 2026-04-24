package domain

import "context"

// FlowDefinitionRepository provides storage operations for [FlowDefinition] aggregates.
type FlowDefinitionRepository interface {
	// CreateFlowDefinition persists a new flow definition and all its child
	// records (purposes, audience, steps, transitions) atomically.
	CreateFlowDefinition(ctx context.Context, def *FlowDefinition) error

	// GetFlowDefinition retrieves the full aggregate for a single definition,
	// including its purposes, audience, steps, and transitions.
	GetFlowDefinition(ctx context.Context, instanceID, id string) (*FlowDefinition, error)

	// ListFlowDefinitions returns the top-level metadata for all definitions
	// belonging to the given instance. Child records are not populated.
	ListFlowDefinitions(ctx context.Context, instanceID string, opts ...FlowDefinitionListOption) ([]*FlowDefinition, error)

	// UpdateFlowDefinitionStatus transitions a definition to the given status.
	UpdateFlowDefinitionStatus(ctx context.Context, instanceID, id string, status FlowDefinitionStatus) error

	// DeleteFlowDefinition removes a definition and all its child records.
	DeleteFlowDefinition(ctx context.Context, instanceID, id string) error
}

// FlowDefinitionListOption modifies a list query.
type FlowDefinitionListOption func(*flowDefinitionListOpts)

type flowDefinitionListOpts struct {
	Status *FlowDefinitionStatus
	Limit  uint32
	Offset uint32
}

func applyFlowDefinitionListOptions(opts []FlowDefinitionListOption) *flowDefinitionListOpts {
	o := &flowDefinitionListOpts{}
	for _, opt := range opts {
		opt(o)
	}
	return o
}

// WithFlowDefinitionStatus filters results to definitions with the given status.
func WithFlowDefinitionStatus(status FlowDefinitionStatus) FlowDefinitionListOption {
	return func(o *flowDefinitionListOpts) {
		o.Status = &status
	}
}

// WithFlowDefinitionLimit sets the maximum number of results to return.
func WithFlowDefinitionLimit(limit uint32) FlowDefinitionListOption {
	return func(o *flowDefinitionListOpts) {
		o.Limit = limit
	}
}

// WithFlowDefinitionOffset skips the first n results.
func WithFlowDefinitionOffset(offset uint32) FlowDefinitionListOption {
	return func(o *flowDefinitionListOpts) {
		o.Offset = offset
	}
}
