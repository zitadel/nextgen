package database

import (
	"context"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// StatementTimer measures one statement call, from ObserveStatement to Done.
// The zero value, which is what ObserveStatement returns when nothing is
// recording, does nothing.
type StatementTimer struct {
	app     *metrics.Application
	ctx     context.Context
	dialect metrics.Dialect
	name    string
	start   time.Time
}

// ObserveStatement starts timing a statement call for the dialect. A dialect's
// executor calls it as the first thing it does and Done as the last, so the
// duration is the whole call, including any wait for a pooled connection.
//
//	defer database.ObserveStatement(ctx, metrics.DialectSQLite).Done()
//
// The statement is named after the statement method that issued the call, e.g.
// "tokenStatements.GetTokenByID", found by walking the stack: the executor sits
// beneath hundreds of methods, none of which pass their own name down. The walk
// is cached per call site, so after a call site's first call it costs the stack
// capture and a map lookup.
//
// Nothing is measured, and no stack is walked, until the server has set the
// default [metrics.Application].
func ObserveStatement(ctx context.Context, dialect metrics.Dialect) StatementTimer {
	app := metrics.Default()
	if !app.Enabled() {
		return StatementTimer{}
	}
	return StatementTimer{app: app, ctx: ctx, dialect: dialect, name: statementName(), start: time.Now()}
}

// Done records the duration.
func (t StatementTimer) Done() {
	if t.app == nil {
		return
	}
	t.app.RecordStatement(t.ctx, t.dialect, t.name, time.Since(t.start))
}

// unknownStatement names a call that no statement method issued: a migration,
// a health check, a test helper.
const unknownStatement = "unknown"

// frameNames caches, per program counter, the statement a frame stands for, or
// "" when it is not a statement method frame.
var frameNames sync.Map // uintptr -> string

// statementName returns the first statement method on the calling stack.
func statementName() string {
	var pcs [24]uintptr
	n := runtime.Callers(2, pcs[:]) // skip Callers and statementName
	for _, pc := range pcs[:n] {
		name, ok := frameNames.Load(pc)
		if !ok {
			name = resolveFrame(pc)
			frameNames.Store(pc, name)
		}
		if s := name.(string); s != "" {
			return s
		}
	}
	return unknownStatement
}

// resolveFrame names the statement method a program counter is in, expanding
// frames inlined into it.
func resolveFrame(pc uintptr) string {
	frames := runtime.CallersFrames([]uintptr{pc})
	for {
		frame, more := frames.Next()
		if name := methodName(frame.Function); name != "" {
			return name
		}
		if !more {
			return ""
		}
	}
}

// methodName turns a function name such as
//
//	github.com/zitadel/nextgen/internal/storage/dialect/postgres.(*tokenStatements).GetTokenByID.func1
//
// into "tokenStatements.GetTokenByID", or returns "" when the function is not
// a method of a statements type. Every statement type is called `xStatements`.
func methodName(function string) string {
	function = function[strings.LastIndexByte(function, '/')+1:]
	_, rest, ok := strings.Cut(function, ".") // drop the package
	if !ok {
		return ""
	}
	rest = strings.NewReplacer("(*", "", ")", "").Replace(rest)
	parts := strings.Split(rest, ".")
	for i, part := range parts {
		if strings.HasSuffix(part, "Statements") && i+1 < len(parts) {
			return part + "." + parts[i+1]
		}
	}
	return ""
}
