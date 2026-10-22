package maputil_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/maputil"
)

func TestGetNested(t *testing.T) {
	t.Parallel()

	m := map[string]any{
		"email": "dummy@example.com",
		"address": map[string]any{
			"street": "main street",
			"geo":    map[string]any{"latitude": 45.0},
		},
		"address.street": "flat",
	}

	tcs := []struct {
		name     string
		path     []string
		expected string
		ok       bool
	}{
		{name: "leaf", path: []string{"email"}, expected: "dummy@example.com", ok: true},
		{name: "nested leaf", path: []string{"address", "street"}, expected: "main street", ok: true},
		// The caller owns the separator, so a segment that contains a dot
		// addresses one key rather than two levels.
		{name: "a dot inside a segment is part of the key", path: []string{"address.street"}, expected: "flat", ok: true},
		{name: "unknown segment", path: []string{"address", "zip"}},
		{name: "descends through a value that is not a map", path: []string{"email", "domain"}},
		// The path resolves, but latitude is a float64 and T is string.
		{name: "leaf is not the requested type", path: []string{"address", "geo", "latitude"}},
		{name: "empty path", path: nil},
	}

	for _, tc := range tcs {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, ok := maputil.GetNested[string](m, tc.path)
			assert.Equal(t, tc.ok, ok)
			assert.Equal(t, tc.expected, got)
		})
	}
}
