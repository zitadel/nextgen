package middleware

import (
	"context"
	"sync"
)

// CorrelationAttribute names the chain a request joined on its server span.
const CorrelationAttribute = "zitadel.correlation_id"

type correlationKey struct{}

// Correlation holds what a request learns inside its handler about the work
// it is part of: the login flow, and the chain of requests (ADR 048,
// amendment of 2026-11-26). A request has one, planted before its handler
// runs, and both emission paths read it: the request event around the handler
// and every domain event inside it. So neither a context derived in between
// nor a copy of the actor can leave the two disagreeing.
type Correlation struct {
	mu    sync.Mutex
	flow  string
	chain string
}

// WithCorrelation plants the request's Correlation, unless ctx carries one.
func WithCorrelation(ctx context.Context) context.Context {
	if _, ok := ctx.Value(correlationKey{}).(*Correlation); ok {
		return ctx
	}
	return context.WithValue(ctx, correlationKey{}, &Correlation{})
}

// CorrelationFromContext is the request's Correlation, or nil outside a
// request. Every method takes a nil receiver and then does nothing.
func CorrelationFromContext(ctx context.Context) *Correlation {
	c, _ := ctx.Value(correlationKey{}).(*Correlation)
	return c
}

// SetFlow names the request's login flow. Empty changes nothing.
func (c *Correlation) SetFlow(flowID string) {
	if c == nil || flowID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.flow = flowID
}

// JoinFlow names the login flow of a request that names none itself. Empty,
// or a request that already has a flow, changes nothing.
func (c *Correlation) JoinFlow(flowID string) {
	if c == nil || flowID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.flow == "" {
		c.flow = flowID
	}
}

// Join puts the request into the chain id names and returns the chain it is
// in afterwards. The first chain joined stays: a request never changes chain.
func (c *Correlation) Join(id string) string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.chain == "" {
		c.chain = id
	}
	return c.chain
}

// Flow and Chain are the request's login flow and chain; empty for none.
func (c *Correlation) Flow() string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.flow
}

func (c *Correlation) Chain() string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.chain
}
