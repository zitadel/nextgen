package domain

import "context"

// FlowSSOProviderResolver turns the connection slugs a step offers into the
// providers rendered to the client, in the step's order.
type FlowSSOProviderResolver interface {
	Resolve(ctx context.Context, projectID string, slugs []string) ([]FlowSSOProvider, error)
}
