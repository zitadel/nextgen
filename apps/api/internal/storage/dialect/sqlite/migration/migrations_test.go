package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFileURI(t *testing.T) {
	t.Parallel()

	for name, tc := range map[string]struct{ path, prefix string }{
		"posix absolute path":      {"/var/data/zitadel.db", "file:///var/data/zitadel.db?"},
		"windows drive path":       {"D:/a/_temp/app/zitadel.db", "file:///D:/a/_temp/app/zitadel.db?"},
		"windows path with spaces": {"C:/Program Files/z/zitadel.db", "file:///C:/Program%20Files/z/zitadel.db?"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			got := FileURI(tc.path)
			assert.True(t, strings.HasPrefix(got, tc.prefix), got)
			assert.Contains(t, got, "foreign_keys")
		})
	}
}
