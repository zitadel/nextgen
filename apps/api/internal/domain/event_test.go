package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestHTTPStatusClassOf(t *testing.T) {
	for status, want := range map[int]domain.HTTPStatusClass{
		100: domain.HTTPStatusClassInformational,
		200: domain.HTTPStatusClassSuccessful,
		204: domain.HTTPStatusClassSuccessful,
		302: domain.HTTPStatusClassRedirection,
		400: domain.HTTPStatusClassClientError,
		499: domain.HTTPStatusClassClientError,
		500: domain.HTTPStatusClassServerError,
		599: domain.HTTPStatusClassServerError,
	} {
		got, ok := domain.HTTPStatusClassOf(status)
		assert.True(t, ok, "%d", status)
		assert.Equal(t, want, got, "%d", status)
	}
	for _, status := range []int{0, 99, 600, 999} {
		_, ok := domain.HTTPStatusClassOf(status)
		assert.False(t, ok, "%d has no class", status)
	}
}

// Every indexed operation has a class, since a list by operation reads it one
// class at a time.
func TestRequestAPIPayload_Indexed(t *testing.T) {
	operation, class := domain.RequestAPIPayload{OperationID: "createUser", Status: 503}.Indexed()
	if assert.NotNil(t, operation) && assert.NotNil(t, class) {
		assert.Equal(t, "createUser", *operation)
		assert.Equal(t, domain.HTTPStatusClassServerError, *class)
	}

	operation, class = domain.RequestAPIPayload{Status: 404}.Indexed()
	assert.Nil(t, operation, "a request refused before an operation ran names none")
	if assert.NotNil(t, class) {
		assert.Equal(t, domain.HTTPStatusClassClientError, *class)
	}

	operation, class = domain.RequestAPIPayload{OperationID: "createUser", Status: 700}.Indexed()
	assert.Nil(t, operation, "no class, no operation")
	assert.Nil(t, class)
}
