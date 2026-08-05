package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
)

func (h *Harness) EnsureTestData(t *testing.T) *test_data.TestData {
	t.Helper()
	h.testData.mutex.Lock()
	defer h.testData.mutex.Unlock()

	if h.testData.value == nil {
		data := test_data.BuildTestData()
		h.testData.value = &data
	}
	return h.testData.value
}
