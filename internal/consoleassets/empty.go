//go:build !embed_console

package consoleassets

import "io/fs"

func FileSystem() (fs.FS, bool) {
	return nil, false
}
