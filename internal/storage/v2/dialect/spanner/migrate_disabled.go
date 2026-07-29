//go:build !spanner_integration

package spanner

import (
	"context"
	"errors"
)

// Migrate implements [database.Pool] but is unavailable without the
// spanner_integration build tag.
func (c *Client) Migrate(ctx context.Context) error {
	if c.isMigrated {
		return nil
	}
	_ = ctx
	return errors.New("spanner migrations require build tag spanner_integration")
}

