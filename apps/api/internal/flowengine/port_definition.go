package flowengine

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// Definitions loads the flow definitions one request's flow runs on, from the
// revisions the release the flow started under pins. The service builds one
// per request; read the active flow's definition through [ActiveDefinition].
type Definitions interface {
	// Definition returns the revision with the given id.
	Definition(ctx context.Context, id string) (*domain.FlowDefinition, error)
}
