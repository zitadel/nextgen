// Package background starts what the server does outside a request: its
// timers, its flushers and the work it does once as it starts.
//
// A process that runs only while it serves a request (server.request_bound:
// a Vercel function, Cloud Run with CPU allocated only during requests) is
// paused between requests, so such work runs late there, or never. Every task
// therefore says what it does in such a process, and one that does not say
// fails the start wherever the server runs (ADR 089).
package background

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
)

// Task is one piece of background work.
type Task struct {
	// Name is what a startup error and the log call the task.
	Name string
	// Disabled is true when the configuration turns the task off: it then
	// starts nowhere.
	Disabled bool
	// Start starts the task in a process that keeps running between requests.
	Start func(ctx context.Context) error
	// Stop stops what was started and waits for it. It may be nil.
	Stop func()
	// RequestBound is what the task does in a process that runs only while it
	// serves a request. It is required: Group.Start refuses a task without
	// it, request bound or not, so the gap shows on a developer's machine and
	// not first in the deployment that pauses.
	RequestBound Answer
}

type answerKind int

const (
	unanswered answerKind = iota
	inRequest
	onTrigger
	unsupported
)

// Answer is what a task does in a process that runs only while it serves a
// request. Its zero value is no answer.
type Answer struct {
	kind    answerKind
	start   func(ctx context.Context) error
	trigger http.Handler
	hint    string
}

// InRequest answers that the work is done while the process runs: a request
// waits for it, or the server does it before it takes its first request.
// start arranges that in place of Task.Start, and its error fails the start.
func InRequest(start func(ctx context.Context) error) Answer {
	return Answer{kind: inRequest, start: start}
}

// OnTrigger answers that the work runs once per call to an endpoint, which a
// scheduler outside the process calls. trigger is that endpoint's handler,
// nil when the configuration does not give it what it needs; needs then says
// what to set. The caller mounts the handler; Task.Start does not run.
func OnTrigger(trigger http.Handler, needs string) Answer {
	return Answer{kind: onTrigger, trigger: trigger, hint: needs}
}

// Unsupported answers that the task cannot run in such a process: the start
// fails while the task is on. instead says what the operator can do.
func Unsupported(instead string) Answer {
	return Answer{kind: unsupported, hint: instead}
}

// Group starts the server's background tasks and stops them together.
type Group struct {
	requestBound bool
	stops        []func()
}

// NewGroup returns the group of a process; requestBound is
// server.request_bound.
func NewGroup(requestBound bool) *Group {
	return &Group{requestBound: requestBound}
}

// Start starts task the way the process allows. An error names the task and
// fails the server's start.
func (g *Group) Start(ctx context.Context, task Task) error {
	if task.Name == "" {
		return errors.New("background task without a name")
	}
	answer := task.RequestBound
	if answer.kind == unanswered || (answer.kind == inRequest && answer.start == nil) {
		return fmt.Errorf("background task %q does not say what it does in a process that runs only while it serves a request: set Task.RequestBound (ADR 089)", task.Name)
	}
	if task.Disabled {
		return nil
	}
	if !g.requestBound {
		if task.Start == nil {
			return fmt.Errorf("background task %q has nothing to start", task.Name)
		}
		if err := task.Start(ctx); err != nil {
			return fmt.Errorf("start %s: %w", task.Name, err)
		}
		g.started(task)
		return nil
	}
	switch answer.kind {
	case onTrigger:
		if answer.trigger == nil {
			return fmt.Errorf("%s cannot run on a timer where server.request_bound is set: %s", task.Name, answer.hint)
		}
		slog.Debug("background task runs when its trigger is called", slog.String("task", task.Name))
	case unsupported:
		return fmt.Errorf("%s cannot run where server.request_bound is set: %s", task.Name, answer.hint)
	default:
		if err := answer.start(ctx); err != nil {
			return fmt.Errorf("%s where server.request_bound is set: %w", task.Name, err)
		}
		g.started(task)
		slog.Debug("background task runs while a request is served", slog.String("task", task.Name))
	}
	return nil
}

func (g *Group) started(task Task) {
	if task.Stop != nil {
		g.stops = append(g.stops, task.Stop)
	}
}

// Close stops the started tasks, the last one first.
func (g *Group) Close() {
	for i := len(g.stops) - 1; i >= 0; i-- {
		g.stops[i]()
	}
	g.stops = nil
}
