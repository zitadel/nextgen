//go:build postgres_integration || spanner_integration

package integration_test

import (
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
)

var harness = helpers.Harness{
	TestData: test_data.BuildTestData(),
}
