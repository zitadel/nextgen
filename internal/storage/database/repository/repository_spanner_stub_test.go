//go:build postgres_integration && !spanner_integration

package repository_test

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
)

func useSpannerContainer() bool { return false }

func newSpannerContainerDB(_ context.Context) (database.PoolTest, func(), error) {
	panic("unreachable: build with -tags spanner_integration to enable Spanner testcontainer")
}

func useSpannerInstance() bool { return false }

func newSpannerInstanceDB(_ context.Context) (database.PoolTest, func(), error) {
	panic("unreachable: build with -tags spanner_integration to enable the Spanner test instance")
}
