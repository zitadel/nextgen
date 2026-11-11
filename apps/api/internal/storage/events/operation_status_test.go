package events_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/events"
)

func TestOperationStatus(t *testing.T) {
	key := events.OperationStatus("createUser", domain.HTTPStatusClassClientError)
	assert.Equal(t, "createUser 4xx", key)
	assert.Equal(t, "createUser", events.OperationOf(key))

	operation, class := "getMyUser", domain.HTTPStatusClassSuccessful
	if got := events.OperationStatusOf(&domain.Event{OperationID: &operation, StatusClass: &class}); assert.NotNil(t, got) {
		assert.Equal(t, "getMyUser 2xx", *got)
	}
	assert.Nil(t, events.OperationStatusOf(&domain.Event{StatusClass: &class}), "a request refused before an operation ran")
	assert.Nil(t, events.OperationStatusOf(&domain.Event{}), "any other event")
}
