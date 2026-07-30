// Package stmttest holds shared behavioral integration tests for v2 statement
// implementations.
//
// Tests assert domain-visible behavior through [service.Pool] /
// [service.AllStatements], not dialect SQL. Run with exactly one integration
// build tag at a time (as CI does):
//
//	go test -tags postgres_integration ./internal/storage/v2/stmttest/
//	go test -tags spanner_integration ./internal/storage/v2/stmttest/
//
// Setting both tags is unsupported: suite files would build, but neither
// TestMain would.
package stmttest
