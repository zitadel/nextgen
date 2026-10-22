package spannerabort

import (
	"context"
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
			req:       &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: beginReadWrite(), Sql: "SELECT 1"},
			wantAbort: true,
		},
		{
			name:   "a query that begins a read-only transaction",
			method: "ExecuteStreamingSql",
			req:    &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: beginReadOnly(), Sql: "SELECT 1"},
		},
		{
			name:   "a single-use query",
			method: "ExecuteStreamingSql",
			req:    &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: singleUse(), Sql: "SELECT 1"},
		},
		{
			name:   "a query later in a transaction",
			method: "ExecuteStreamingSql",
			req:    &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "SELECT 1"},
		},
		{
			name:         "DML later in a transaction",
			method:       "ExecuteSql",
			req:          &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1", Seqno: 1},
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

			// Rate 1 aborts every eligible call, so only eligibility decides.
			v := New(1, 1).decide(service+tt.method, tt.req)
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

func TestDecideAtRateZeroAbortsNothing(t *testing.T) {
	t.Parallel()

	in := New(0, 1)
	for method, req := range map[string]any{
		"ExecuteStreamingSql": &spannerpb.ExecuteSqlRequest{Transaction: beginReadWrite()},
		"ExecuteSql":          &spannerpb.ExecuteSqlRequest{Transaction: inTransaction(testTx), Seqno: 1},
		"Commit":              &spannerpb.CommitRequest{Transaction: &spannerpb.CommitRequest_TransactionId{TransactionId: testTx}},
	} {
		assert.NoError(t, in.decide(service+method, req).err, method)
	}
}

// After an injected abort the transaction is over, as it is after a real one:
// every later call in it fails the same way and nothing is rolled back twice.
func TestAbortedTransactionStaysAborted(t *testing.T) {
	t.Parallel()

	in := New(1, 1)
	dml := &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1", Seqno: 1}
	require.Equal(t, testTx, in.decide(service+"ExecuteSql", dml).rollback)

	in.rate = 0 // from here on only the earlier abort can fail a call
	query := &spannerpb.ExecuteSqlRequest{Session: testSession, Transaction: inTransaction(testTx), Sql: "SELECT 1"}
	v := in.decide(service+"ExecuteStreamingSql", query)
	assert.Equal(t, codes.Aborted, status.Code(v.err), "a later query in the aborted transaction")
	assert.Nil(t, v.rollback)

	commit := &spannerpb.CommitRequest{Session: testSession, Transaction: &spannerpb.CommitRequest_TransactionId{TransactionId: testTx}}
	v = in.decide(service+"Commit", commit)
	assert.Equal(t, codes.Aborted, status.Code(v.err), "the commit of the aborted transaction")
	assert.Nil(t, v.rollback)

	assert.NoError(t, in.decide(service+"Commit", commit).err, "the commit ended the aborted transaction")
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
		client, rec := dial(t, New(1, 1))

		stream, err := client.ExecuteStreamingSql(t.Context(), &spannerpb.ExecuteSqlRequest{
			Session: testSession, Transaction: inTransaction(testTx), Sql: "UPDATE t SET a = 1 THEN RETURN a", Seqno: 1,
		})
		require.NoError(t, err)
		_, err = stream.Recv()
		assert.Equal(t, codes.Aborted, status.Code(err))
		assert.Equal(t, []string{"Rollback"}, rec.seen())
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
