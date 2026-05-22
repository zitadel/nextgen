//go:build integration

package integration_test

import (
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
)

var harness = helpers.Harness{}

func init() {
	harness.TestData = test_data.BuildTestData()
}
