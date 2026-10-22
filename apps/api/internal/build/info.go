package build

import (
	"log/slog"
	"time"
)

// These variables are overridden via ldflags by the local and release build
// scripts. The defaults keep direct `go run` and `go test` invocations honest
// without treating an unstamped development binary as a broken release.
var (
	version = "dev"
	commit  = "none"
	date    = ""
)

// dateTime is the parsed version of [date]
var dateTime time.Time

// init parses the ldflag-injected date before concurrent access.
func init() {
	if date == "" {
		return
	}
	var err error
	dateTime, err = time.Parse(time.RFC3339, date)
	if err != nil {
		slog.Warn("could not parse build date", "date", date, "err", err)
	}
}

// Version returns the current build version of Zitadel
func Version() string {
	return version
}

// Commit returns the git commit hash of the current build of Zitadel
func Commit() string {
	return commit
}

// Date returns the build date of the current build of Zitadel
func Date() time.Time {
	return dateTime
}
