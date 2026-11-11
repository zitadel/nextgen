// Package background starts what the server does outside a request: its
// timers, its flushers and the work it does once as it starts.
//
// Whether such work runs depends on how the platform keeps the process
// running (server.lifecycle). A process that is paused between requests runs
// no timer, and one whose last instance the platform stops runs a timer only
// while an instance is up. Every task therefore says what it does in each,
// and one that does not say fails the start wherever the server runs
// (ADR 089).
package background

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

// Lifecycle is how the platform keeps the server's process running: the value
// of server.lifecycle. Its zero value is AlwaysOn.
type Lifecycle string

const (
	// AlwaysOn is a process that runs from its start to its stop, with an
	// instance up at any time: Docker, a VM, Kubernetes.
	AlwaysOn Lifecycle = "always_on"
	// ScaleToZero is a process that runs between requests, on a platform that
	// stops the last instance when no request comes and starts one for the
	// next: Knative, Cloud Run with CPU always allocated.
	ScaleToZero Lifecycle = "scale_to_zero"
	// RequestOnly is a process the platform pauses between requests: a Vercel
	// function, Cloud Run with CPU allocated only during requests.
	RequestOnly Lifecycle = "request_only"
)

// Lifecycles are the values server.lifecycle takes.
var Lifecycles = []Lifecycle{AlwaysOn, ScaleToZero, RequestOnly}

// Validate reports a value server.lifecycle does not take.
func (l Lifecycle) Validate() error {
	switch l {
	case "", AlwaysOn, ScaleToZero, RequestOnly:
		return nil
	}
	values := make([]string, len(Lifecycles))
	for i, lifecycle := range Lifecycles {
		values[i] = string(lifecycle)
	}
	return fmt.Errorf("server.lifecycle is %q, not one of %s", string(l), strings.Join(values, ", "))
}

// Task is one piece of background work.
type Task struct {
	// Name is what a startup error and the log call the task.
	Name string
	// Disabled is true when the configuration turns the task off: it then
	// starts nowhere.
	Disabled bool
	// Start starts the task in a process that runs between requests.
	Start func(ctx context.Context) error
	// Stop stops what was started and waits for it. It may be nil.
	Stop func()
	// ScaleToZero is what the task does where the platform stops the last
	// instance, and RequestOnly what it does in a process paused between
	// requests. Both are required: Group.Start refuses a task without them
	// in every lifecycle, so the gap shows on a developer's machine and not
	// first in the deployment it breaks.
	ScaleToZero Answer
	RequestOnly Answer
}

type answerKind int

const (
	unanswered answerKind = iota
	whileUp
	inRequest
	onTrigger
	unsupported
)

// Answer is what a task does in one lifecycle. Its zero value is no answer.
type Answer struct {
	kind    answerKind
	start   func(ctx context.Context) error
	trigger http.Handler
	hint    string
}

// WhileUp answers that Task.Start does the job where instances come and go:
// the task works as an instance starts or continues from what is stored, so
// it does not need one process to live through a whole interval. It is no
// answer for RequestOnly, where no timer runs.
func WhileUp() Answer {
	return Answer{kind: whileUp}
}

// InRequest answers that the work is done while a request is served: a
// request waits for it, or the server does it before it takes its first.
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

// Unsupported answers that the task cannot run in that lifecycle: the start
// fails while the task is on. instead says what the operator can do.
func Unsupported(instead string) Answer {
	return Answer{kind: unsupported, hint: instead}
}

// Group starts the server's background tasks and stops them together.
type Group struct {
	lifecycle Lifecycle
	stops     []func()
}

// NewGroup returns the group of a process whose server.lifecycle is
// lifecycle.
func NewGroup(lifecycle Lifecycle) *Group {
	if lifecycle == "" {
		lifecycle = AlwaysOn
	}
	return &Group{lifecycle: lifecycle}
}

// Start starts task the way the lifecycle allows. An error names the task and
// fails the server's start.
func (g *Group) Start(ctx context.Context, task Task) error {
	if task.Name == "" {
		return errors.New("background task without a name")
	}
	if err := task.answered(); err != nil {
		return err
	}
	if task.Disabled {
		return nil
	}
	answer := Answer{kind: whileUp}
	switch g.lifecycle {
	case AlwaysOn:
	case ScaleToZero:
		answer = task.ScaleToZero
	case RequestOnly:
		answer = task.RequestOnly
	default:
		return g.lifecycle.Validate()
	}
	switch answer.kind {
	case onTrigger:
		if answer.trigger == nil {
			return fmt.Errorf("%s cannot run on a timer where server.lifecycle is %s: %s", task.Name, g.lifecycle, answer.hint)
		}
		slog.Debug("background task runs when its trigger is called", slog.String("task", task.Name))
	case unsupported:
		return fmt.Errorf("%s cannot run where server.lifecycle is %s: %s", task.Name, g.lifecycle, answer.hint)
	case inRequest:
		if err := answer.start(ctx); err != nil {
			return fmt.Errorf("%s where server.lifecycle is %s: %w", task.Name, g.lifecycle, err)
		}
		g.started(task)
		slog.Debug("background task runs while a request is served", slog.String("task", task.Name))
	default:
		if task.Start == nil {
			return fmt.Errorf("background task %q has nothing to start", task.Name)
		}
		if err := task.Start(ctx); err != nil {
			return fmt.Errorf("start %s: %w", task.Name, err)
		}
		g.started(task)
	}
	return nil
}

// answered reports a task that leaves a lifecycle without an answer.
func (t Task) answered() error {
	for _, declared := range []struct {
		lifecycle Lifecycle
		field     string
		answer    Answer
	}{
		{ScaleToZero, "Task.ScaleToZero", t.ScaleToZero},
		{RequestOnly, "Task.RequestOnly", t.RequestOnly},
	} {
		answer := declared.answer
		missing := answer.kind == unanswered ||
			(answer.kind == inRequest && answer.start == nil) ||
			(answer.kind == whileUp && declared.lifecycle == RequestOnly)
		if missing {
			return fmt.Errorf("background task %q does not say what it does where server.lifecycle is %s: set %s (ADR 089)", t.Name, declared.lifecycle, declared.field)
		}
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
