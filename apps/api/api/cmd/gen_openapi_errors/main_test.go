package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestErrorFileStem(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "att-invalid-proof", errorFileStem("att.invalid_proof"))
	assert.Equal(t, "not-implemented", errorFileStem("not_implemented"))
	assert.Equal(t, "internal", errorFileStem("internal"))
}
