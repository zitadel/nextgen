package spannerabort

import (
	"context"
	"fmt"
	"net"
	"slices"
	"strings"
	"sync"
	"testing"

	"cloud.google.com/go/spanner/apiv1/spannerpb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

const testSession = "projects/p/instances/i/databases/d/sessions/s"

var testTx = []byte("tx-1")

func beginReadWrite() *spannerpb.TransactionSelector {
	return &spannerpb.TransactionSelector{Selector: &spannerpb.TransactionSelector_Begin{
		Begin: &spannerpb.TransactionOptions{Mode: &spannerpb.TransactionOptions_ReadWrite_{
			ReadWrite: &spannerpb.TransactionOptions_ReadWrite{},
		}},
	}}
}

func beginReadOnly() *spannerpb.TransactionSelector {
	return &spannerpb.TransactionSelector{Selector: &spannerpb.TransactionSelector_Begin{
		Begin: &spannerpb.TransactionOptions{Mode: &spannerpb.TransactionOptions_ReadOnly_{
			ReadOnly: &spannerpb.TransactionOptions_ReadOnly{},
		}},
	}}
}

func singleUse() *spannerpb.TransactionSelector {
	return &spannerpb.TransactionSelector{Selector: &spannerpb.TransactionSelector_SingleUse{
		SingleUse: &spannerpb.TransactionOptions{Mode: &spannerpb.TransactionOptions_ReadOnly_{
			ReadOnly: &spannerpb.TransactionOptions_ReadOnly{},
		}},
	}}
}

func inTransaction(id []byte) *spannerpb.TransactionSelector {
	return &spannerpb.TransactionSelector{Selector: &spannerpb.TransactionSelector_Id{Id: id}}
}

func TestDecide(t *testing.T) {
	t.Parallel()

	// Every ExecuteSqlRequest carries a seqno, as the client numbers each
	// statement: only the SQL tells a write from a read.
	tests := []struct {
		name         string
		method       string
		req          any
		wantAbort    bool
		wantRollback []byte
	}{
		{
			name:      "a query that begins a read-write transaction",
			method:    "ExecuteStreamingSql",
			req:       &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: beginReadWrite(), Sql: "SELECT 1", Seqno: 1},
			wantAbort: true,
		},
		{
			name:   "a query that begins a read-only transaction",
			method: "ExecuteStreamingSql",
			req:    &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: beginReadOnly(), Sql: "SELECT 1", Seqno: 1},
		},
		{
			name:   "a single-use query",
			method: "ExecuteStreamingSql",
			req:    &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: singleUse(), Sql: "SELECT 1", Seqno: 1},
		},
		{
			name:   "a query later in a transaction",
			method: "ExecuteStreamingSql",
			req:    &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "SELECT 1", Seqno: 2},
		},
		{
			name:         "DML later in a transaction",
			method:       "ExecuteSql",
			req:          &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1", Seqno: 2},
			wantAbort:    true,
			wantRollback: testTx,
		},
		{
			name:   "DML that returns rows, on the streaming call",
			method: "ExecuteStreamingSql",
			req: &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx),
				Sql: "UPDATE t SET a = 1 THEN RETURN a", Seqno: 2},
			wantAbort:    true,
			wantRollback: testTx,
		},
		{
			name:   "DML behind a comment and a statement hint",
			method: "ExecuteSql",
			req: &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx),
				Sql: "-- prune\n@{LOCK_SCANNED_RANGES=exclusive} DELETE FROM t WHERE a = 1", Seqno: 2},
			wantAbort:    true,
			wantRollback: testTx,
		},
		{
			name:   "batch DML later in a transaction",
			method: "ExecuteBatchDml",
			req: &spannerpb.ExecuteBatchDmlRequest{Session: testSession, Transaction: inTransaction(testTx), Seqno: 1,
				Statements: []*spannerpb.ExecuteBatchDmlRequest_Statement{{Sql: "UPDATE t SET a = 1"}}},
			wantAbort:    true,
			wantRollback: testTx,
		},
		{
			name:      "a read that begins a read-write transaction",
			method:    "StreamingRead",
			req:       &spannerpb.ReadRequest{Session: testSession, Transaction: beginReadWrite(), Table: "t"},
			wantAbort: true,
		},
		{
			name:   "a read later in a transaction",
			method: "StreamingRead",
			req:    &spannerpb.ReadRequest{Session: testSession, Transaction: inTransaction(testTx), Table: "t"},
		},
		{
			name:         "a commit",
			method:       "Commit",
			req:          &spannerpb.CommitRequest{Session: testSession, Transaction: &spannerpb.CommitRequest_TransactionId{TransactionId: testTx}},
			wantAbort:    true,
			wantRollback: testTx,
		},
		{
			name:   "a single-use commit",
			method: "Commit",
			req: &spannerpb.CommitRequest{Session: testSession, Transaction: &spannerpb.CommitRequest_SingleUseTransaction{
				SingleUseTransaction: &spannerpb.TransactionOptions{},
			}},
		},
		{
			name:   "an explicit begin",
			method: "BeginTransaction",
			req:    &spannerpb.BeginTransactionRequest{Session: testSession},
		},
		{
			name:   "a rollback",
			method: "Rollback",
			req:    &spannerpb.RollbackRequest{Session: testSession, TransactionId: testTx},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			// Rate 1 picks every transaction and depth 1 aborts it at its first
			// eligible call, so only eligibility decides.
			in := New(1, 1)
			in.depth = 1
			v := in.decide(service+tt.method, tt.req)
			if !tt.wantAbort {
				assert.NoError(t, v.err)
				return
			}
			require.Error(t, v.err)
			assert.Equal(t, codes.Aborted, status.Code(v.err))
			assert.Equal(t, tt.wantRollback, v.rollback)
			if tt.wantRollback != nil {
				assert.Equal(t, testSession, v.session)
			}
		})
	}
}

func TestIsDML(t *testing.T) {
	t.Parallel()

	for sql, want := range map[string]bool{
		"UPDATE t SET a = 1":                        true,
		"  update t set a = 1":                      true,
		"INSERT OR UPDATE INTO t (a) VALUES (1)":    true,
		"DELETE FROM t WHERE a = 1":                 true,
		"UPDATE t SET a = 1 THEN RETURN a":          true,
		"-- prune\nDELETE FROM t":                   true,
		"# prune\nDELETE FROM t":                    true,
		"/* prune */ DELETE FROM t":                 true,
		"@{LOCK_SCANNED_RANGES=exclusive} UPDATE t": true,
		"SELECT a FROM t":                           false,
		"SELECT updated_at FROM t":                  false,
		"WITH x AS (SELECT 1 AS a) SELECT a FROM x": false,
		"UPDATED t":       false,
		"/* never closed": false,
		"":                false,
	} {
		assert.Equal(t, want, isDML(sql), "%q", sql)
	}
}

func TestDecideAtRateZeroAbortsNothing(t *testing.T) {
	t.Parallel()

	in := New(0, 1)
	for method, req := range map[string]any{
		"ExecuteStreamingSql": &spannerpb.ExecuteSqlRequest{Transaction: beginReadWrite()},
		"ExecuteSql":          &spannerpb.ExecuteSqlRequest{Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1", Seqno: 1},
		"Commit":              &spannerpb.CommitRequest{Transaction: &spannerpb.CommitRequest_TransactionId{TransactionId: testTx}},
	} {
		assert.NoError(t, in.decide(service+method, req).err, method)
	}
}

// runTransaction drives one transaction of writes then a commit through the
// injector the way the client does: it stops at the first abort, which ends the
// attempt. It reports which call was aborted, 0 for none; writes+1 is the
// commit.
func runTransaction(in *Injector, id []byte, writes int) int {
	for i := 1; i <= writes; i++ {
		dml := &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(id), Sql: "UPDATE t SET a = 1", Seqno: int64(i)}
		if in.decide(service+"ExecuteSql", dml).err != nil {
			return i
		}
	}
	commit := &spannerpb.CommitRequest{Session: testSession, Transaction: &spannerpb.CommitRequest_TransactionId{TransactionId: id}}
	if in.decide(service+"Commit", commit).err != nil {
		return writes + 1
	}
	return 0
}

func TestATransactionIsAbortedAtMostOnce(t *testing.T) {
	t.Parallel()

	t.Run("a picked transaction aborts within its first writes", func(t *testing.T) {
		t.Parallel()
		in := New(1, 3) // rate 1 picks every transaction
		for i := range 200 {
			at := runTransaction(in, fmt.Appendf(nil, "tx-%d", i), 10)
			assert.True(t, at >= 1 && at <= maxDepth, "aborted at call %d", at)
		}
	})

	t.Run("one that ends sooner aborts at its commit", func(t *testing.T) {
		t.Parallel()
		in := New(1, 3)
		for i := range 200 {
			at := runTransaction(in, fmt.Appendf(nil, "tx-%d", i), 1)
			assert.True(t, at == 1 || at == 2, "aborted at call %d", at)
		}
	})

	t.Run("nothing more is injected in an aborted transaction", func(t *testing.T) {
		t.Parallel()
		in := New(1, 3)
		in.depth = 1
		dml := &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1", Seqno: 1}
		require.Error(t, in.decide(service+"ExecuteSql", dml).err)

		// A callback that swallowed the abort goes on; the server, not the
		// injector, refuses the rolled-back transaction.
		dml.Seqno = 2
		assert.NoError(t, in.decide(service+"ExecuteSql", dml).err)
		commit := &spannerpb.CommitRequest{Session: testSession, Transaction: &spannerpb.CommitRequest_TransactionId{TransactionId: testTx}}
		assert.NoError(t, in.decide(service+"Commit", commit).err)
		assert.Empty(t, in.plan, "the commit ends what the injector knows about it")
	})
}

// The chance that a transaction is aborted does not grow with its writes. When
// every write was a draw of its own, a transaction of dozens of writes almost
// never committed inside its 30-second retry budget.
func TestLongTransactionsAreNotStarved(t *testing.T) {
	t.Parallel()

	in := New(0.1, 11)
	const transactions, writes = 4000, 60
	aborted, abortedAtWrite := 0, 0
	for i := range transactions {
		switch at := runTransaction(in, fmt.Appendf(nil, "tx-%d", i), writes); {
		case at == 0:
		case at <= writes:
			aborted++
			abortedAtWrite++
		default:
			aborted++
		}
	}
	assert.InDelta(t, 0.1, float64(aborted)/transactions, 0.02)
	// A commit ends what the injector knows about a transaction. One aborted at
	// a write stays marked, because the client never commits it.
	assert.Len(t, in.plan, abortedAtWrite)
}

func TestARollbackForgetsTheTransaction(t *testing.T) {
	t.Parallel()

	in := New(0, 1)
	dml := &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1", Seqno: 1}
	require.NoError(t, in.decide(service+"ExecuteSql", dml).err)
	require.Contains(t, in.plan, string(testTx))

	in.decide(service+"Rollback", &spannerpb.RollbackRequest{Session: testSession, TransactionId: testTx})
	assert.Empty(t, in.plan)
}

func TestSeedReplaysDecisions(t *testing.T) {
	t.Parallel()

	draws := func(seed uint64) []bool {
		in := New(0.5, seed)
		req := &spannerpb.ExecuteSqlRequest{Transaction: beginReadWrite()}
		out := make([]bool, 64)
		for i := range out {
			out[i] = in.decide(service+"ExecuteSql", req).err != nil
		}
		return out
	}
	assert.Equal(t, draws(42), draws(42))
	assert.NotEqual(t, draws(42), draws(43))
}

func TestRate(t *testing.T) {
	t.Parallel()

	in := New(0.1, 7)
	req := &spannerpb.ExecuteSqlRequest{Transaction: beginReadWrite()}
	const calls = 20000
	aborted := 0
	for range calls {
		if in.decide(service+"ExecuteSql", req).err != nil {
			aborted++
		}
	}
	assert.InDelta(t, 0.1, float64(aborted)/calls, 0.01)
}

func TestAbortMessageNamesTheCallAndSeed(t *testing.T) {
	t.Parallel()

	req := &spannerpb.ExecuteSqlRequest{Transaction: beginReadWrite(), Sql: "SELECT  id\n  FROM projects"}
	err := New(1, 42).decide(service+"ExecuteStreamingSql", req).err
	assert.EqualError(t, err, "rpc error: code = Aborted desc = spannerabort: injected ABORTED on ExecuteStreamingSql (seed 42): SELECT id FROM projects")
}

// recorder notes every call that reaches the server.
type recorder struct {
	mu      sync.Mutex
	methods []string
}

func (r *recorder) add(method string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.methods = append(r.methods, strings.TrimPrefix(method, service))
}

func (r *recorder) seen() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.methods)
}

// dial connects a Spanner client through the injector to an in-process server
// that implements nothing: a call that reaches it fails Unimplemented, so the
// recorder tells what got through.
func dial(t *testing.T, in *Injector) (spannerpb.SpannerClient, *recorder) {
	t.Helper()

	rec := &recorder{}
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer(
		grpc.ChainUnaryInterceptor(func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
			rec.add(info.FullMethod)
			return handler(ctx, req)
		}),
		grpc.ChainStreamInterceptor(func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
			rec.add(info.FullMethod)
			return handler(srv, ss)
		}),
	)
	spannerpb.RegisterSpannerServer(srv, spannerpb.UnimplementedSpannerServer{})
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)

	opts := append([]grpc.DialOption{
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	}, in.DialOptions()...)
	conn, err := grpc.NewClient("passthrough:///bufnet", opts...)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return spannerpb.NewSpannerClient(conn), rec
}

func TestInterceptors(t *testing.T) {
	t.Parallel()

	commit := &spannerpb.CommitRequest{Session: testSession, Transaction: &spannerpb.CommitRequest_TransactionId{TransactionId: testTx}}

	t.Run("an aborted commit rolls the transaction back instead", func(t *testing.T) {
		t.Parallel()
		client, rec := dial(t, New(1, 1))

		_, err := client.Commit(t.Context(), commit)
		assert.Equal(t, codes.Aborted, status.Code(err))
		assert.Equal(t, []string{"Rollback"}, rec.seen())
	})

	t.Run("a commit let through reaches the server", func(t *testing.T) {
		t.Parallel()
		client, rec := dial(t, New(0, 1))

		_, err := client.Commit(t.Context(), commit)
		assert.Equal(t, codes.Unimplemented, status.Code(err))
		assert.Equal(t, []string{"Commit"}, rec.seen())
	})

	t.Run("an aborted statement that begins a transaction never reaches the server", func(t *testing.T) {
		t.Parallel()
		client, rec := dial(t, New(1, 1))

		stream, err := client.ExecuteStreamingSql(t.Context(), &spannerpb.ExecuteSqlRequest{
			Session: testSession, Transaction: beginReadWrite(), Sql: "SELECT 1",
		})
		require.NoError(t, err)
		_, err = stream.Recv()
		assert.Equal(t, codes.Aborted, status.Code(err))
		assert.Empty(t, rec.seen())
	})

	t.Run("an aborted DML statement rolls its transaction back", func(t *testing.T) {
		t.Parallel()
		in := New(1, 1)
		in.depth = 1
		client, rec := dial(t, in)

		stream, err := client.ExecuteStreamingSql(t.Context(), &spannerpb.ExecuteSqlRequest{
			Session: testSession, Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1 THEN RETURN a", Seqno: 1,
		})
		require.NoError(t, err)
		_, err = stream.Recv()
		assert.Equal(t, codes.Aborted, status.Code(err))
		assert.Equal(t, []string{"Rollback"}, rec.seen())
		assert.Equal(t, spared, in.plan[string(testTx)],
			"the injector's own rollback must not clear the abort it just made")
	})

	t.Run("a single-use query passes through", func(t *testing.T) {
		t.Parallel()
		client, rec := dial(t, New(1, 1))

		stream, err := client.ExecuteStreamingSql(t.Context(), &spannerpb.ExecuteSqlRequest{
			Session: testSession, Transaction: singleUse(), Sql: "SELECT 1",
		})
		require.NoError(t, err)
		_, err = stream.Recv()
		assert.Equal(t, codes.Unimplemented, status.Code(err))
		assert.Equal(t, []string{"ExecuteStreamingSql"}, rec.seen())
	})
}
