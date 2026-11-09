//go:build !spanner_integration

package spanner

import "google.golang.org/api/option"

// clientOptions adds nothing outside integration builds. The abort injector the
// Spanner integration tests install is in client_options_integration.go.
func clientOptions() ([]option.ClientOption, error) {
	return nil, nil
}
