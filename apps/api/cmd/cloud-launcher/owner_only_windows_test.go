//go:build windows

package main

import (
	"os"
	"testing"
)

// Windows has no POSIX file modes, so there is no owner-only mode to assert.
func assertOwnerOnly(t *testing.T, _ os.FileInfo) {
	t.Helper()
}
