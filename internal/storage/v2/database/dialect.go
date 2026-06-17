package database

import "context"

// Dialect connects to a database engine and returns a [Pool].
type Dialect interface {
	Name() string
	Connect(ctx context.Context) (Pool, error)
}

// StatementerFrom returns the [Statementer] for a client value when supported.
type StatementerFrom interface {
	Statementer() Statementer
}
