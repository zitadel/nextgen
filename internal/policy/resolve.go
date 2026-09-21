package policy

import (
	"context"
	"slices"
)

// Hint carries the request's audience coordinates for instance resolution.
type Hint struct {
	TeamID string
}

// Resolver picks the instance that governs one operation for one request.
// Returning nil means no instance is authored and the template defaults
// apply.
type Resolver interface {
	Resolve(ctx context.Context, projectID, operation string, hint Hint) (*Instance, error)
}

// ResolverFunc adapts a function to [Resolver].
type ResolverFunc func(ctx context.Context, projectID, operation string, hint Hint) (*Instance, error)

func (f ResolverFunc) Resolve(ctx context.Context, projectID, operation string, hint Hint) (*Instance, error) {
	return f(ctx, projectID, operation, hint)
}

// StaticResolver resolves from an in-memory set of instances per project,
// applying ADR 065's rules: the most specific matching instance wins
// wholesale, an unscoped instance is the project default, and a scoped
// instance never applies outside its audience. Prototype stand-in for the
// release-backed resolver.
type StaticResolver struct {
	instances map[string][]*Instance
}

// NewStaticResolver builds a resolver over the given project's instances.
func NewStaticResolver() *StaticResolver {
	return &StaticResolver{instances: make(map[string][]*Instance)}
}

// Add registers instances for a project.
func (r *StaticResolver) Add(projectID string, instances ...*Instance) {
	r.instances[projectID] = append(r.instances[projectID], instances...)
}

func (r *StaticResolver) Resolve(_ context.Context, projectID, operation string, hint Hint) (*Instance, error) {
	var best *Instance
	bestScore := 0
	for _, inst := range r.instances[projectID] {
		if inst.Operation != operation {
			continue
		}
		score := audienceScore(inst.Audience, hint)
		if score > bestScore {
			best, bestScore = inst, score
		}
	}
	return best, nil
}

// audienceScore ranks an instance for a request: 2 for a team match, 1 for
// the project default, 0 when the instance is scoped elsewhere.
func audienceScore(a Audience, hint Hint) int {
	if a.IsEmpty() {
		return 1
	}
	if hint.TeamID != "" && slices.Contains(a.TeamIDs, hint.TeamID) {
		return 2
	}
	return 0
}

// Effective resolves the governing instance and falls back to the template
// defaults when none is authored.
func Effective(ctx context.Context, e *Engine, r Resolver, projectID, operation string, hint Hint) (*Instance, error) {
	if r != nil {
		inst, err := r.Resolve(ctx, projectID, operation, hint)
		if err != nil {
			return nil, err
		}
		if inst != nil {
			return inst, nil
		}
	}
	return e.DefaultInstance(operation)
}
