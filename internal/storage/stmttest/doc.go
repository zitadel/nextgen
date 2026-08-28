// Package stmttest holds shared behavioral integration tests for v2 statement
// implementations.
//
// Suites assert domain-visible behavior through [service.AllStatements], not
// dialect SQL. Dialects register via build tags; TestMain brings up every
// registered dialect and [forEachDialect] loops them:
//
//	go test -tags postgres_integration ./internal/storage/stmttest/
//	go test -tags spanner_integration ./internal/storage/stmttest/
//	go test -tags sqlite_integration ./internal/storage/stmttest/
//	go test -tags 'postgres_integration,spanner_integration,sqlite_integration' ./internal/storage/stmttest/
//
// `go test` caches successful results per package. Build tags already change
// the test binary (each adapter's open_*.go), and TestAdapterCacheKey also
// reads ZITADEL_STMTTEST_ADAPTER inside a Test so the cache slot is per
// adapter. Moon's server:test-{postgres,spanner,sqlite} tasks set that
// variable; getenv in TestMain or init would not count (golang/go#44625).
package stmttest
