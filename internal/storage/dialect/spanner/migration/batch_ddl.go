//go:build spanner_integration

package migration

// DDL batching for migrations.
//
// # What this does, and why it is not obvious from the call site
//
// goose executes every statement in a migration file as its own Exec. Spanner
// requires DDL outside transactions (hence [goose.WithIsolateDDL]), and on a
// real Cloud Spanner instance each DDL Exec becomes its own
// UpdateDatabaseDdl long-running operation costing on the order of tens of
// seconds. Measured on run 33069782911: ~43 minutes of schema setup for ~1
// minute of tests, 97-98% of the lane, per package (#973).
//
// [OpenDB] therefore returns a *sql.DB whose connections can group consecutive
// DDL into a single UpdateDatabaseDdl call. goose is unchanged and unaware; it
// still owns version bookkeeping, ordering and failure handling.
//
// # Batching is opt-in, and must stay that way
//
// Buffering is per *connection*, so it is only safe where the caller holds one
// connection for the whole sequence. goose does: it checks out a single
// *sql.Conn, runs a file's statements on it, then records the version on that
// same connection. Code that goes through the *sql.DB pool does not, and mixing
// the two silently breaks: a CREATE TABLE buffered on one pooled connection is
// invisible to a SELECT that the pool happens to serve from another, and the
// buffered statements are then discarded when the first connection is reset.
// [ensureLeaseRow] does exactly that, which is why batching is not automatic.
//
// So DDL is batched only when the context says so, via [WithDDLBatching], which
// [Migrate] applies to the context it hands goose and to nothing else.
//
// # The behaviour to know about when debugging a migration
//
//   - Under a batching context, a DDL Exec that appears to succeed has only
//     been *buffered*. It is sent when the connection next does anything else:
//     a query, a non-DDL Exec (in practice goose's version INSERT, which
//     immediately follows each file's statements), a prepare, a transaction, or
//     a ping.
//   - Consequently a syntax or schema error in statement N of a file surfaces
//     at the flush, not at statement N, and goose reports it against whatever
//     triggered the flush. The error text from Spanner still names the offending
//     statement, so read the message rather than the position.
//   - goose runs one migration file per connection checkout, so batches align
//     with files. That is deliberate: Spanner DDL batches are not atomic (a
//     failure leaves earlier statements applied), so keeping the boundary at the
//     file preserves exactly the recovery behaviour goose already had. Do not
//     widen it to the whole pending set without revisiting that.
//   - A connection reset or closed with a batch still buffered *flushes* it,
//     best effort, rather than discarding. That costs a late apply in the
//     anomalous case, and buys the guarantee that DDL never disappears without
//     an error: dropping it silently is how a misplaced [WithDDLBatching] would
//     otherwise erase schema. It also bounds the blast radius of marking a
//     pooled context by mistake, since the flush lands before the connection can
//     serve anyone else.
//
// The emulator applies DDL instantly, so none of this is observable locally;
// only a real instance shows the difference.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"sync/atomic"

	"cloud.google.com/go/spanner/admin/database/apiv1/databasepb"
	spannerdriver "github.com/googleapis/go-sql-spanner"
	"github.com/googleapis/go-sql-spanner/parser"
)

type ddlBatchKey struct{}

// WithDDLBatching marks ctx as one whose consecutive DDL may be grouped into a
// single UpdateDatabaseDdl call. Only use it for work that holds one connection
// for the whole DDL-then-read sequence; see the file comment for why pooled
// callers must not be marked.
func WithDDLBatching(ctx context.Context) context.Context {
	return context.WithValue(ctx, ddlBatchKey{}, true)
}

func ddlBatchingEnabled(ctx context.Context) bool {
	enabled, _ := ctx.Value(ddlBatchKey{}).(bool)
	return enabled
}

// OpenDB opens a *sql.DB for migrations whose connections batch consecutive DDL
// into one UpdateDatabaseDdl call when the context opts in via
// [WithDDLBatching]. See the file comment above for the semantics this
// introduces.
func OpenDB(dsn string) (*sql.DB, error) {
	cfg, err := spannerdriver.ExtractConnectorConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse spanner dsn: %w", err)
	}
	base, err := spannerdriver.CreateConnector(cfg)
	if err != nil {
		return nil, fmt.Errorf("create spanner connector: %w", err)
	}
	// Statement classification is the driver's own, not a prefix heuristic of
	// ours: it already handles comments, hints and quoting correctly.
	p, err := parser.NewStatementParser(databasepb.DatabaseDialect_GOOGLE_STANDARD_SQL, 0)
	if err != nil {
		return nil, fmt.Errorf("create spanner statement parser: %w", err)
	}
	return sql.OpenDB(batchConnector{base: base, parser: p}), nil
}

type batchConnector struct {
	base   driver.Connector
	parser *parser.StatementParser
}

func (c batchConnector) Connect(ctx context.Context) (driver.Conn, error) {
	inner, err := c.base.Connect(ctx)
	if err != nil {
		return nil, err
	}
	sc, ok := inner.(spannerdriver.SpannerConn)
	if !ok {
		// Without the batching API there is nothing to wrap; degrade to the
		// plain connection rather than failing migrations outright.
		return inner, nil
	}
	return &batchConn{Conn: inner, spanner: sc, parser: c.parser}, nil
}

func (c batchConnector) Driver() driver.Driver { return c.base.Driver() }

// batchConn buffers consecutive DDL and flushes it before anything else.
//
// It embeds driver.Conn so the many optional interfaces the driver implements
// keep working, and overrides only the entry points that either start a batch
// or must flush one first.
type batchConn struct {
	driver.Conn
	spanner spannerdriver.SpannerConn
	parser  *parser.StatementParser
	open    bool
}

var (
	_ driver.ExecerContext      = (*batchConn)(nil)
	_ driver.QueryerContext     = (*batchConn)(nil)
	_ driver.ConnPrepareContext = (*batchConn)(nil)
	_ driver.ConnBeginTx        = (*batchConn)(nil)
	_ driver.SessionResetter    = (*batchConn)(nil)
	_ driver.Pinger             = (*batchConn)(nil)
)

// Counters exist so a test can prove batching actually engaged. Without them a
// context that failed to reach goose's Exec calls would silently disable the
// whole thing and every suite would still pass, since the emulator applies DDL
// instantly either way.
var (
	ddlBatchesRun       atomic.Int64
	ddlStatementsBuffed atomic.Int64
)

func (c *batchConn) isDDL(query string) bool {
	info := c.parser.DetectStatementType(query)
	return info != nil && info.StatementType == parser.StatementTypeDdl
}

// flush sends a buffered batch. Safe to call when nothing is buffered.
func (c *batchConn) flush(ctx context.Context) error {
	if !c.open {
		return nil
	}
	c.open = false
	ddlBatchesRun.Add(1)
	if err := c.spanner.RunBatch(ctx); err != nil {
		return fmt.Errorf("run spanner ddl batch: %w", err)
	}
	return nil
}

// flushBestEffort sends a buffered batch where the caller cannot receive an
// error: connection reset and close. Applying late beats discarding silently.
// Dropping the batch here would make a CREATE TABLE vanish with no error
// reported anywhere, which is the worst failure mode this type could have.
func (c *batchConn) flushBestEffort() {
	if !c.open {
		return
	}
	c.open = false
	ddlBatchesRun.Add(1)
	_ = c.spanner.RunBatch(context.Background())
}

func (c *batchConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if ddlBatchingEnabled(ctx) && c.isDDL(query) {
		if !c.open {
			if err := c.spanner.StartBatchDDL(); err != nil {
				return nil, fmt.Errorf("start spanner ddl batch: %w", err)
			}
			c.open = true
		}
		ddlStatementsBuffed.Add(1)
	} else if err := c.flush(ctx); err != nil {
		return nil, err
	}
	execer, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	return execer.ExecContext(ctx, query, args)
}

func (c *batchConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if err := c.flush(ctx); err != nil {
		return nil, err
	}
	queryer, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	return queryer.QueryContext(ctx, query, args)
}

// PrepareContext flushes because a prepared statement's later Exec bypasses
// this type entirely, so anything buffered has to go out first.
func (c *batchConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	if err := c.flush(ctx); err != nil {
		return nil, err
	}
	if p, ok := c.Conn.(driver.ConnPrepareContext); ok {
		return p.PrepareContext(ctx, query)
	}
	return c.Conn.Prepare(query)
}

func (c *batchConn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}

func (c *batchConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if err := c.flush(ctx); err != nil {
		return nil, err
	}
	if b, ok := c.Conn.(driver.ConnBeginTx); ok {
		return b.BeginTx(ctx, opts)
	}
	return c.Conn.Begin()
}

func (c *batchConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *batchConn) Ping(ctx context.Context) error {
	if err := c.flush(ctx); err != nil {
		return err
	}
	if p, ok := c.Conn.(driver.Pinger); ok {
		return p.Ping(ctx)
	}
	return nil
}

// ResetSession runs when the pool takes the connection back. Flush rather than
// discard: a caller that batched on a pooled connection would otherwise lose the
// statements entirely, and flushing here still happens before the connection can
// serve anyone else.
func (c *batchConn) ResetSession(ctx context.Context) error {
	c.flushBestEffort()
	if r, ok := c.Conn.(driver.SessionResetter); ok {
		return r.ResetSession(ctx)
	}
	return nil
}

func (c *batchConn) Close() error {
	c.flushBestEffort()
	return c.Conn.Close()
}
