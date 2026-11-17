//go:build !windows

package main

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func assertOwnerOnly(t *testing.T, info os.FileInfo) {
	t.Helper()
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}
