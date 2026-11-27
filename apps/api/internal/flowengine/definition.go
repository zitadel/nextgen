package flowengine

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// Definitions looks up flow definitions by id within the flow's project.
// Read the active flow's definition through [ActiveDefinition].
type Definitions interface {
	// Definition returns the revision with the given id.
	Definition(ctx context.Context, id string) (*domain.FlowDefinition, error)
}

// ActiveDefinition returns the definition of the flow active in state, the
// one every read of the running flow's steps goes through. The active flow's
// progress sits at the root of the state, so it is the one DefinitionID names.
func ActiveDefinition(ctx context.Context, defs Definitions, state *State) (*domain.FlowDefinition, error) {
	if defs == nil || state == nil {
		return nil, fmt.Errorf("%w: active definition without definitions or state", domain.ErrFlowIntegrity())
	}
	def, err := defs.Definition(ctx, state.DefinitionID)
	if err != nil {
		return nil, err
	}
	if def == nil {
		return nil, fmt.Errorf("%w: definition %q missing", domain.ErrFlowIntegrity(), state.DefinitionID)
	}
	return def, nil
}
