package domain

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
)

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/flow_definition.mock.go . FlowDefinitionRepository

// FlowDefinitionRepository provides storage operations for [FlowDefinition] aggregates.
type FlowDefinitionRepository interface {
	// CreateFlowDefinition persists a new flow definition and all its child
	// records (purposes, audience, steps, transitions) atomically.
	CreateFlowDefinition(ctx context.Context, client database.QueryExecutor, def *FlowDefinition) error

	// GetFlowDefinition retrieves the full aggregate for a single definition,
	// including its purposes, audience, steps, and transitions.
	GetFlowDefinition(ctx context.Context, client database.QueryExecutor, projectID, id string) (*FlowDefinition, error)

	// ListFlowDefinitions returns the top-level metadata for all definitions
	// belonging to the given instance. Child records are not populated.
	ListFlowDefinitions(ctx context.Context, client database.QueryExecutor, projectID string, opts ...FlowDefinitionListOption) ([]*FlowDefinition, error)

	// UpdateFlowDefinitionStatus transitions a definition to the given status.
	UpdateFlowDefinitionStatus(ctx context.Context, client database.QueryExecutor, projectID, id string, status FlowDefinitionStatus) error

	// DeleteFlowDefinition removes a definition and all its child records.
	DeleteFlowDefinition(ctx context.Context, client database.QueryExecutor, projectID, id string) error
}

// FlowDefinitionListOption modifies a list query.
type FlowDefinitionListOption func(*FlowDefinitionListOpts)

// FlowDefinitionListOpts holds the resolved options for a list query.
type FlowDefinitionListOpts struct {
	Name          *string
	Status        *FlowDefinitionStatus
	Purpose       *FlowDefinitionPurpose
	SchemaVersion *string
	Limit         uint32
	Offset        uint32
}

// ApplyFlowDefinitionListOptions resolves a slice of options into a struct.
func ApplyFlowDefinitionListOptions(opts []FlowDefinitionListOption) *FlowDefinitionListOpts {
	o := &FlowDefinitionListOpts{}
	for _, opt := range opts {
		opt(o)
	}
	return o
}

// WithFlowDefinitionName filters results to definitions matching the given name.
// Names act as project-scoped slugs.
//
// TODO: enforce uniqueness of (project_id, name, schema_version) at the
// storage layer. The flow service currently assumes at most one row per
// name + version; without a DB constraint two concurrent admin writes could
// break that assumption.
func WithFlowDefinitionName(name string) FlowDefinitionListOption {
	return func(o *FlowDefinitionListOpts) {
		o.Name = &name
	}
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

// WithFlowDefinitionOffset filters results according to the schema version
func WithSchemaVersion(schemaVersion string) FlowDefinitionListOption {
	return func(o *FlowDefinitionListOpts) {
		o.SchemaVersion = &schemaVersion
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
