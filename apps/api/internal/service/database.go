package service

import (
	"context"
	"sync/atomic"

	"github.com/zitadel/nextgen/internal/domain"
)

type Pool interface {
	Transactioner[AllStatements]
	Statementer[AllStatements]
}

type Statementer[S any] interface {
	Statements() S
}

type Transactioner[S any] interface {
	Transaction(ctx context.Context, fn func(ctx context.Context, tx Statementer[S]) error) error
}

func NewPool(pool Pool) *DB {
	return &DB{
		pool: pool,
	}
}

type DB struct {
	pool Pool
	// eventsStored is told of the events a write stored, once they are
	// committed. Nil, nobody is.
	eventsStored atomic.Pointer[EventsStoredFunc]
}

// EventsStoredFunc is told that events of eventTypes were stored in a
// project and are committed. It must not fail and must not take long: it
// runs in the request that wrote them.
type EventsStoredFunc func(ctx context.Context, projectID string, eventTypes []domain.EventType)

// NotifyEventsStored has notify told of every event written through the
// pool from now on: after the transaction that inserted it has committed,
// and for an insert outside a transaction as it returns. A transaction that
// rolls back tells nothing.
//
// This is the one place every event passes on its way into the table,
// whichever path emitted it (audit.Emit in a mutation's transaction, the
// request buffer's batch), and the only one that knows the commit.
func (p *DB) NotifyEventsStored(notify EventsStoredFunc) {
	p.eventsStored.Store(&notify)
}

func (p *DB) Transaction(ctx context.Context, callback func(ctx context.Context, tx Statementer[AllStatements]) error) error {
	notify := p.eventsStored.Load()
	if notify == nil {
		return p.pool.Transaction(ctx, callback)
	}
	var stored *storedEvents
	err := p.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		// New with every attempt: a retry replays the callback, and only
		// what the attempt that commits inserted is stored.
		stored = &storedEvents{}
		return callback(ctx, recordingTx{tx: tx, stored: stored})
	})
	if err != nil || stored == nil {
		return err
	}
	for projectID, eventTypes := range stored.byProject {
		(*notify)(ctx, projectID, eventTypes)
	}
	return nil
}

// Statements implements [Pool].
func (p *DB) Statements() AllStatements {
	notify := p.eventsStored.Load()
	if notify == nil {
		return p.pool.Statements()
	}
	return notifyingStatements{AllStatements: p.pool.Statements(), notify: *notify}
}

// storedEvents are the event types one attempt of a transaction inserted,
// by project.
type storedEvents struct {
	byProject map[string][]domain.EventType
}

// recordingTx hands out a transaction's statements with InsertEvent
// recording into stored.
type recordingTx struct {
	tx     Statementer[AllStatements]
	stored *storedEvents
}

func (r recordingTx) Statements() AllStatements {
	return recordingStatements{AllStatements: r.tx.Statements(), stored: r.stored}
}

type recordingStatements struct {
	AllStatements
	stored *storedEvents
}

func (s recordingStatements) InsertEvent(ctx context.Context, event *domain.Event) error {
	if err := s.AllStatements.InsertEvent(ctx, event); err != nil {
		return err
	}
	if s.stored.byProject == nil {
		s.stored.byProject = map[string][]domain.EventType{}
	}
	s.stored.byProject[event.ProjectID] = append(s.stored.byProject[event.ProjectID], event.EventType)
	return nil
}

// notifyingStatements are the pool's statements outside a transaction: an
// event they insert is committed as the insert returns.
type notifyingStatements struct {
	AllStatements
	notify EventsStoredFunc
}

func (s notifyingStatements) InsertEvent(ctx context.Context, event *domain.Event) error {
	if err := s.AllStatements.InsertEvent(ctx, event); err != nil {
		return err
	}
	s.notify(ctx, event.ProjectID, []domain.EventType{event.EventType})
	return nil
}

var _ Pool = (*DB)(nil)

// TODO(adlerhurst): the code below is prepared for go 1.27
// it then replaces [abstractPool.Transaction] and [abstractPool.Statements] with generic versions
// Visit https://gotipplay.golang.org/p/nVKh1r65BJ- to see the generic version of [abstractPool.Transaction] and [abstractPool.Statements] in action.

// func (p *abstractPool) Transaction[S any](ctx context.Context, callback func(ctx context.Context, tx Statementer[S]) error) error {
// 	return ap.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[Statements]) error {
// 		return callback(ctx, abstractStatementer[S]{tx})
// 	})
// }

// func (ap AbstractPool) Statements[S any]() S {
// 	return ap.pool.Statements().(S)
// }

// type abstractStatementer[S any] struct {
// 	Statementer[Statements]
// }

// func (as abstractStatementer[S]) Statements() S {
// 	return as.Statementer.Statements().(S)
// }

// func (ap AbstractPool) As[S any]() typedAbstractPool[S] { return typedAbstractPool[S]{ap} }

// type typedAbstractPool[S any] struct{ ap AbstractPool }

// func (tap typedAbstractPool[S]) Transaction(ctx context.Context, callback func(context.Context, Statementer[S]) error) error {
// 	return tap.ap.Transaction[S](ctx, callback)
// }

// func (tap typedAbstractPool[S]) Statements() S {
// 	return tap.ap.Statements[S]()
// }
