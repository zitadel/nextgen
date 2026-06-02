//go:build embed_console

package consoleassets

import (
	"embed"
	"io/fs"
)

//go:embed dist
var embedded embed.FS

func FileSystem() (fs.FS, bool) {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, false
	}
	return sub, true
}
