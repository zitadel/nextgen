//go:build postgres_integration || spanner_integration

package integration_test

import (
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

var harness helpers.Harness
