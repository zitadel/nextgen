package replacers

import (
	"log/slog"

	"github.com/zitadel/sloggcp"
)

func ReplaceErrKeys(groups []string, a slog.Attr) slog.Attr {
	if len(groups) == 0 && a.Key == "err" {
		a.Key = sloggcp.ErrorKey
	}
	return a
}
