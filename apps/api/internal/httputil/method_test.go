package httputil_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/httputil"
)

func TestIsSafeMethod(t *testing.T) {
	t.Parallel()

	for _, method := range []string{"GET", "HEAD", "OPTIONS", "get", "head", "options"} {
		assert.True(t, httputil.IsSafeMethod(method), method)
	}
	for _, method := range []string{"POST", "PUT", "PATCH", "DELETE", "post", "delete", "TRACE", ""} {
		assert.False(t, httputil.IsSafeMethod(method), method)
	}
}
