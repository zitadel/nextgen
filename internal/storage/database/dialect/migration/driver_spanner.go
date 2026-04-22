//go:build spanner

// Build with -tags spanner to include the Spanner migration driver.
// This is a separate file because the spanner driver pulls in the full
// google-cloud-go/spanner dependency tree; keeping it opt-in avoids that
// cost for builds that only target PostgreSQL.
//
// Required additional dependency (not in go.mod by default):
//
//	go get github.com/googleapis/go-sql-spanner
package migration

import _ "github.com/golang-migrate/migrate/v4/database/spanner"
