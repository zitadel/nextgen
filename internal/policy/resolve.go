package policy

import "context"

// Resolver returns the instance that governs one operation in one project.
// Returning nil means no instance is authored and the template defaults
// apply.
type Resolver interface {
	Resolve(ctx context.Context, projectID, operation string) (*Instance, error)
}

// ResolverFunc adapts a function to [Resolver].
type ResolverFunc func(ctx context.Context, projectID, operation string) (*Instance, error)

func (f ResolverFunc) Resolve(ctx context.Context, projectID, operation string) (*Instance, error) {
	return f(ctx, projectID, operation)
}

// StaticResolver resolves from an in-memory set of instances, one per
// operation per project; the last one added for an operation wins, the way
// the newest stored revision does. Prototype stand-in for the release-backed
// resolver.
type StaticResolver struct {
	instances map[string]map[string]*Instance
}

// NewStaticResolver builds an empty resolver.
func NewStaticResolver() *StaticResolver {
	return &StaticResolver{instances: make(map[string]map[string]*Instance)}
}

// Add registers instances for a project, replacing any earlier instance for
// the same operation.
func (r *StaticResolver) Add(projectID string, instances ...*Instance) {
	byOperation, ok := r.instances[projectID]
	if !ok {
		byOperation = make(map[string]*Instance)
		r.instances[projectID] = byOperation
	}
	for _, inst := range instances {
		byOperation[inst.Operation] = inst
	}
}

func (r *StaticResolver) Resolve(_ context.Context, projectID, operation string) (*Instance, error) {
	return r.instances[projectID][operation], nil
}

// Effective resolves the project's instance and falls back to the template
// defaults when none is authored.
func Effective(ctx context.Context, e *Engine, r Resolver, projectID, operation string) (*Instance, error) {
	if r != nil {
		inst, err := r.Resolve(ctx, projectID, operation)
		if err != nil {
			return nil, err
		}
		if inst != nil {
			return inst, nil
		}
	}
	return e.DefaultInstance(operation)
}
