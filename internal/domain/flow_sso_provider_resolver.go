package domain

import "context"

// FlowSSOProviderResolver turns the connection slugs a step offers into the
// providers rendered to the client, in the step's order. A slug with no
// connection in the project is dropped and logged with stepName; any other
// lookup error is returned.
type FlowSSOProviderResolver interface {
	Resolve(ctx context.Context, projectID, stepName string, slugs []string) ([]FlowSSOProvider, error)
}
