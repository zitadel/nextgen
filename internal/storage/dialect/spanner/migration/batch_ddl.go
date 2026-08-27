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
// connection for the whole sequence. goose does: Provider.initialize checks out
// a single *sql.Conn and runMigrations reuses it for the entire Up run (goose
// v3.27.1). Code that goes through the *sql.DB pool does not, and mixing the two
// silently breaks: a CREATE TABLE buffered on one pooled connection is invisible
// to a SELECT that the pool happens to serve from another, and the buffered
// statements would then be stranded on the first connection.
// [ensureLeaseRow] does exactly that, which is why batching is not automatic.
//
// So DDL is batched only when the context says so, via [WithDDLBatching], which
// [Migrate] applies to the context it hands goose and to nothing else.
//
// # The alternative that was considered and rejected
//
// go-sql-spanner accepts START BATCH DDL and RUN BATCH as client-side statements
// through the ordinary Exec path, and every migration file here already carries
// `-- +goose NO TRANSACTION`, so goose execs each statement on the held
// connection. Bracketing each file's statements with those two lines would
// produce the same per-file batching in about 38 lines of SQL, with no driver
// wrapper, no build-tagged stub and no dependency on the driver's parser.
//
// It was rejected for one reason: the batch boundary would become a convention
// every future migration file has to remember twice, where here it cannot be
// forgotten. That is the whole trade, and it is the only reason this file is
// larger than the alternative.
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
//   - Batches end at non-DDL statements, and that is the only thing bounding
//     them. goose reuses one connection for the whole Up run, so the file
//     boundary is not structural: it holds because goose writes the version row
//     after each file, and that DML forces a flush. A file mixing DDL and DML
//     therefore produces several batches, which is harmless. What would not be
//     harmless is removing the per-file version write, since the whole pending
//     set would then travel as one batch. Spanner DDL batches are not atomic (a
//     failure leaves earlier statements applied), so that would widen the window
//     in which a failure leaves schema applied with no version recorded, well
//     past what goose already had. TestMigrateBatchesDDLPerFile pins the
//     boundary count so that change cannot land silently.
//   - A connection reset or closed with a batch still buffered *flushes* it
//     rather than discarding, and reports a failed flush through the reset or
//     close error. That costs a late apply in the anomalous case, and buys the
//     guarantee that DDL never disappears without an error: dropping it silently
//     is how a misplaced [WithDDLBatching] would otherwise erase schema. It also
//     bounds the blast radius of marking a pooled context by mistake, since the
//     flush lands before the connection can serve anyone else.
//
// The emulator applies DDL instantly, so none of this is observable locally;
// only a real instance shows the difference.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
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
	//
	// Caveat for whoever bumps go-sql-spanner: NewStatementParser documents
	// itself as "an internal function that can receive breaking changes without
	// prior notice", so this is outside the module's compatibility promise. A
	// signature change is loud, a change in how statements are classified is
	// quiet and would silently stop batching or misapply it. TestMigrateBatches
	// DDLPerFile is the tripwire for the quiet case: if DDL stopped being
	// recognised, its statement counter would fall to zero and the test fails.
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
// It embeds driver.Conn for the required methods and overrides the entry points
// that either start a batch or must flush one first. Embedding does *not* carry
// the optional interfaces across: Go promotes methods of the driver.Conn
// interface, not of whatever concrete type is behind it, so anything the Spanner
// connection implements beyond driver.Conn is invisible here unless forwarded
// explicitly. CheckNamedValue and IsValid are forwarded below for that reason;
// the assertions in the var block are what stop a future one being missed.
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
	_ driver.NamedValueChecker  = (*batchConn)(nil)
	_ driver.Validator          = (*batchConn)(nil)
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

// flushOnTeardown sends a buffered batch from reset or close. Applying late
// beats discarding silently: dropping the batch here would make a CREATE TABLE
// vanish with no error reported anywhere, which is the worst failure mode this
// type could have. The error is returned so callers that have somewhere to put
// it (Close) do not swallow a failed flush.
func (c *batchConn) flushOnTeardown() error {
	if !c.open {
		return nil
	}
	c.open = false
	ddlBatchesRun.Add(1)
	if err := c.spanner.RunBatch(context.Background()); err != nil {
		return fmt.Errorf("run spanner ddl batch on teardown: %w", err)
	}
	return nil
}

func (c *batchConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	buffering := false
	if ddlBatchingEnabled(ctx) && c.isDDL(query) {
		if !c.open {
			if err := c.spanner.StartBatchDDL(); err != nil {
				return nil, fmt.Errorf("start spanner ddl batch: %w", err)
			}
			c.open = true
		}
		buffering = true
	} else if err := c.flush(ctx); err != nil {
		return nil, err
	}
	execer, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	res, err := execer.ExecContext(ctx, query, args)
	// Counted on the success path only, so the number the test reports is
	// statements actually buffered. c.open deliberately stays set on failure:
	// whatever was buffered before this statement still has to be flushed.
	if buffering && err == nil {
		ddlStatementsBuffed.Add(1)
	}
	return res, err
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
	flushErr := c.flushOnTeardown()
	if r, ok := c.Conn.(driver.SessionResetter); ok {
		return errors.Join(flushErr, r.ResetSession(ctx))
	}
	return flushErr
}

// Close still closes the underlying connection when the flush fails, but
// reports the failure rather than losing it: a connection closed with buffered
// DDL that could not be applied must not look like a clean close.
func (c *batchConn) Close() error {
	flushErr := c.flushOnTeardown()
	return errors.Join(flushErr, c.Conn.Close())
}

// CheckNamedValue and IsValid are forwarded explicitly. Embedding driver.Conn
// only promotes methods of that *interface*, so any optional interface the
// concrete Spanner connection satisfies is invisible through the wrapper.
// Dropping CheckNamedValue would silently change parameter conversion, and
// dropping IsValid would stop the pool from discarding dead connections.
func (c *batchConn) CheckNamedValue(v *driver.NamedValue) error {
	if checker, ok := c.Conn.(driver.NamedValueChecker); ok {
		return checker.CheckNamedValue(v)
	}
	return driver.ErrSkip
}

func (c *batchConn) IsValid() bool {
	if v, ok := c.Conn.(driver.Validator); ok {
		return v.IsValid()
	}
	return true
}
