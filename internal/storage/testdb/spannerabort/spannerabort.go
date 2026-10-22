// Package spannerabort makes a Spanner client see ABORTED on a seeded share of
// its read-write calls, the way lock contention would. The Spanner integration
// tests install it so that transaction callbacks are retried on every run:
// Spanner, Omni included, aborts only on a real conflict over the same rows,
// which a test suite produces too rarely to catch a callback that drops the
// status or cannot be replayed (#788).
//
// Two draws can abort an attempt at a read-write transaction:
//
//   - The statement that begins it (inline begin). An aborted one is never
//     sent, so the server has nothing to undo.
//   - The transaction itself, drawn once at its first write or its commit. A
//     transaction it picks is aborted at one of its first few writes, or at its
//     commit if it ends sooner, after a rollback on the server, as a real abort
//     ends it. It is never aborted twice, so a long transaction is no less
//     likely to commit than a short one.
//
// Reads later in a transaction, single-use reads and single-use commits are
// never aborted: their requests do not say whether a read-write transaction is
// in progress, and an abort outside one is not retried.
package spannerabort

import (
	"context"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/spanner/apiv1/spannerpb"
	"google.golang.org/grpc" //egress:allow test-only interceptors on a Spanner client's own connection; nothing here dials
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const service = "/google.spanner.v1.Spanner/"

// rollbackTimeout bounds the rollback that stands in for the server ending an
// aborted transaction. It is best effort: if it fails, the transaction's locks
// last until Spanner's idle timeout instead.
const rollbackTimeout = 10 * time.Second

// maxDepth is how many writes into a transaction its abort can land: on one of
// the first maxDepth, or on its commit if it ends sooner.
const maxDepth = 4

// spared marks a transaction the injector has decided to leave alone, or has
// already aborted.
const spared = -1

// Injector decides which calls to abort. It is safe for concurrent use.
type Injector struct {
	rate  float64
	seed  uint64
	depth int

	mu   sync.Mutex
	rng  *rand.Rand
	plan map[string]int // by transaction ID: writes left until its abort, or spared
}

// New returns an Injector that aborts with probability rate at each draw,
// drawing from a generator seeded with seed. The seed fixes the sequence of
// draws, not which call gets each one: with tests running in parallel the
// order of calls varies between runs, so a seed replays a failure most reliably
// for a single test run on its own.
func New(rate float64, seed uint64) *Injector {
	return &Injector{
		rate:  rate,
		seed:  seed,
		depth: maxDepth,
		rng:   rand.New(rand.NewPCG(seed, seed)),
		plan:  map[string]int{},
	}
}

// DialOptions returns the interceptors to install on the client's connection.
func (in *Injector) DialOptions() []grpc.DialOption {
	return []grpc.DialOption{
		grpc.WithChainUnaryInterceptor(in.interceptUnary),
		grpc.WithChainStreamInterceptor(in.interceptStream),
	}
}

// verdict is the decision for one call. A nil err lets the call through;
// a non-nil rollback names the transaction to roll back before aborting.
type verdict struct {
	err      error
	session  string
	rollback []byte
}

func (in *Injector) decide(method string, req any) verdict {
	call := strings.TrimPrefix(method, service)
	var (
		sel     *spannerpb.TransactionSelector
		session string
		sql     string
		write   bool
	)
	switch r := req.(type) {
	case *spannerpb.CommitRequest:
		if id := r.GetTransactionId(); id != nil && in.abortInTransaction(id, true) {
			return verdict{err: in.status(call, ""), session: r.GetSession(), rollback: id}
		}
		return verdict{}
	case *spannerpb.RollbackRequest:
		in.forget(r.GetTransactionId())
		return verdict{}
	case *spannerpb.ExecuteSqlRequest:
		// A read-write transaction numbers its DML; a query carries no seqno.
		sel, session, sql, write = r.GetTransaction(), r.GetSession(), r.GetSql(), r.GetSeqno() != 0
	case *spannerpb.ExecuteBatchDmlRequest:
		sel, session, write = r.GetTransaction(), r.GetSession(), true
		if statements := r.GetStatements(); len(statements) > 0 {
			sql = statements[0].GetSql()
		}
	case *spannerpb.ReadRequest:
		sel, session, sql = r.GetTransaction(), r.GetSession(), "read "+r.GetTable()
	default:
		return verdict{}
	}

	switch {
	case sel.GetBegin().GetReadWrite() != nil:
		in.mu.Lock()
		hit := in.roll()
		in.mu.Unlock()
		if hit {
			return verdict{err: in.status(call, sql)}
		}
	case write && sel.GetId() != nil:
		if id := sel.GetId(); in.abortInTransaction(id, false) {
			return verdict{err: in.status(call, sql), session: session, rollback: id}
		}
	}
	return verdict{}
}

// abortInTransaction reports whether to abort this write or commit in an open
// read-write transaction. The transaction is drawn once, at its first such
// call; see the package documentation.
func (in *Injector) abortInTransaction(id []byte, commit bool) bool {
	in.mu.Lock()
	defer in.mu.Unlock()

	key := string(id)
	left, drawn := in.plan[key]
	if !drawn {
		left = spared
		if in.roll() {
			left = 1 + in.rng.IntN(in.depth)
		}
	}
	if commit {
		// The commit ends the transaction: an abort its writes did not reach
		// lands here.
		delete(in.plan, key)
		return left != spared
	}
	switch left {
	case spared:
		in.plan[key] = spared
		return false
	case 1:
		in.plan[key] = spared
		return true
	default:
		in.plan[key] = left - 1
		return false
	}
}

// forget drops what the injector knows about a transaction the client rolled
// back itself.
func (in *Injector) forget(id []byte) {
	if id == nil {
		return
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	delete(in.plan, string(id))
}

// roll draws once from the generator. Callers hold mu.
func (in *Injector) roll() bool {
	return in.rate > 0 && in.rng.Float64() < in.rate
}

func (in *Injector) status(call, sql string) error {
	msg := fmt.Sprintf("spannerabort: injected ABORTED on %s (seed %d)", call, in.seed)
	if sql != "" {
		msg += ": " + abbreviate(sql)
	}
	return status.Error(codes.Aborted, msg)
}

// abbreviate keeps enough of a statement to recognise it in a test failure.
func abbreviate(sql string) string {
	const limit = 80
	runes := []rune(strings.Join(strings.Fields(sql), " "))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit-3]) + "..."
}

// ownRollback marks the rollbacks the injector sends itself, which its own
// interceptor lets through untouched: the transaction stays marked as aborted.
type ownRollback struct{}

func (in *Injector) interceptUnary(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
	if ctx.Value(ownRollback{}) != nil {
		return invoker(ctx, method, req, reply, cc, opts...)
	}
	v := in.decide(method, req)
	if v.err == nil {
		return invoker(ctx, method, req, reply, cc, opts...)
	}
	if v.rollback != nil {
		rollback(ctx, cc, v.session, v.rollback)
	}
	return v.err
}

func (in *Injector) interceptStream(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	switch method {
	case service + "ExecuteStreamingSql", service + "StreamingRead":
		return &deferredStream{in: in, ctx: ctx, desc: desc, cc: cc, method: method, streamer: streamer, opts: opts}, nil
	}
	return streamer(ctx, desc, cc, method, opts...)
}

// rollback ends a transaction the injector aborted after the server had begun
// it, releasing its locks as a real abort would. Best effort; see
// [rollbackTimeout].
func rollback(ctx context.Context, cc *grpc.ClientConn, session string, tx []byte) {
	ctx, cancel := context.WithTimeout(context.WithValue(context.WithoutCancel(ctx), ownRollback{}, true), rollbackTimeout)
	defer cancel()
	_, _ = spannerpb.NewSpannerClient(cc).Rollback(ctx, &spannerpb.RollbackRequest{Session: session, TransactionId: tx})
}

// deferredStream opens the real stream only once it has seen the request, so
// an aborted call never reaches the server: a statement that would have begun
// a transaction leaves nothing behind.
type deferredStream struct {
	in       *Injector
	ctx      context.Context
	desc     *grpc.StreamDesc
	cc       *grpc.ClientConn
	method   string
	streamer grpc.Streamer
	opts     []grpc.CallOption

	real grpc.ClientStream // nil until the request is let through
	err  error             // the injected ABORTED, once decided
}

func (s *deferredStream) SendMsg(m any) error {
	if s.real != nil {
		return s.real.SendMsg(m)
	}
	if s.err != nil {
		return nil
	}
	if v := s.in.decide(s.method, m); v.err != nil {
		if v.rollback != nil {
			rollback(s.ctx, s.cc, v.session, v.rollback)
		}
		s.err = v.err
		return nil
	}
	real, err := s.streamer(s.ctx, s.desc, s.cc, s.method, s.opts...)
	if err != nil {
		return err
	}
	s.real = real
	return real.SendMsg(m)
}

func (s *deferredStream) RecvMsg(m any) error {
	if s.real != nil {
		return s.real.RecvMsg(m)
	}
	if s.err != nil {
		return s.err
	}
	return status.Error(codes.Internal, "spannerabort: RecvMsg before SendMsg")
}

func (s *deferredStream) CloseSend() error {
	if s.real != nil {
		return s.real.CloseSend()
	}
	return nil
}

// Header reports no metadata for an aborted call; RecvMsg carries its status,
// as gRPC does for a stream that ends without headers.
func (s *deferredStream) Header() (metadata.MD, error) {
	if s.real != nil {
		return s.real.Header()
	}
	return nil, nil
}

func (s *deferredStream) Trailer() metadata.MD {
	if s.real != nil {
		return s.real.Trailer()
	}
	return nil
}

func (s *deferredStream) Context() context.Context {
	if s.real != nil {
		return s.real.Context()
	}
	return s.ctx
}
