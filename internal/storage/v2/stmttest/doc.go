// Package stmttest holds shared behavioral integration tests for v2 statement
// implementations.
//
// Suites assert domain-visible behavior through [service.AllStatements], not
// dialect SQL. Run with exactly one integration build tag (as CI does):
//
//	go test -tags postgres_integration ./internal/storage/v2/stmttest/
//	go test -tags spanner_integration ./internal/storage/v2/stmttest/
//
// Setting both tags is unsupported (no dialect openPool).
package stmttest
