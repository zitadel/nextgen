//go:build !spanner_integration

package migration

import "context"

// WithDDLBatching is a no-op without the spanner_integration build tag, which is
// the only configuration that links the Spanner driver and can therefore batch
// anything. migrations.go is not build-tagged and calls this unconditionally, so
// the stub keeps untagged builds compiling. Mirrors the migrate_integration.go /
// migrate_disabled.go pair one package up.
//
// The real implementation, and the semantics it introduces, are in batch_ddl.go.
func WithDDLBatching(ctx context.Context) context.Context { return ctx }
