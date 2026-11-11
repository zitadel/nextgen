package background

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// probe records what a Group did with a task.
type probe struct {
	started, inRequest, stopped int
}

// task returns a task that gives answer in both lifecycles that need one.
// WhileUp is no answer for RequestOnly, so there it becomes Unsupported.
func (p *probe) task(answer func(*probe) Answer) Task {
	task := Task{
		Name:        "probe",
		Start:       func(context.Context) error { p.started++; return nil },
		Stop:        func() { p.stopped++ },
		ScaleToZero: answer(p),
		RequestOnly: answer(p),
	}
	if task.RequestOnly.kind == whileUp {
		task.RequestOnly = Unsupported("turn it off")
	}
	return task
}

func answersInRequest(p *probe) Answer {
	return InRequest(func(context.Context) error { p.inRequest++; return nil })
}

func answersWhileUp(*probe) Answer { return WhileUp() }

var handler = http.NotFoundHandler()

func TestLifecycleValidate(t *testing.T) {
	for _, lifecycle := range append([]Lifecycle{""}, Lifecycles...) {
		assert.NoError(t, lifecycle.Validate(), lifecycle)
	}
	err := Lifecycle("serverless").Validate()
	require.ErrorContains(t, err, `server.lifecycle is "serverless", not one of always_on, scale_to_zero, request_only`)
}

// A task that leaves a lifecycle without an answer fails the start in every
// lifecycle, so adding one cannot go unnoticed until it meets the deployment
// it does not run in.
func TestGroupRefusesATaskWithoutAnAnswer(t *testing.T) {
	start := func(context.Context) error { return nil }
	for _, lifecycle := range append([]Lifecycle{""}, Lifecycles...) {
		t.Run(string(lifecycle), func(t *testing.T) {
			for name, tc := range map[string]struct {
				task  Task
				field string
			}{
				"no answer":                 {Task{Start: start}, "server.lifecycle is scale_to_zero: set Task.ScaleToZero"},
				"no answer, off":            {Task{Disabled: true}, "server.lifecycle is scale_to_zero: set Task.ScaleToZero"},
				"scale to zero only":        {Task{Start: start, ScaleToZero: WhileUp()}, "server.lifecycle is request_only: set Task.RequestOnly"},
				"request only only":         {Task{Start: start, RequestOnly: Unsupported("turn it off")}, "set Task.ScaleToZero"},
				"in request, no start":      {Task{Start: start, ScaleToZero: WhileUp(), RequestOnly: InRequest(nil)}, "set Task.RequestOnly"},
				"a timer where none runs":   {Task{Start: start, ScaleToZero: WhileUp(), RequestOnly: WhileUp()}, "set Task.RequestOnly"},
				"scale to zero, no start":   {Task{Start: start, ScaleToZero: InRequest(nil), RequestOnly: Unsupported("turn it off")}, "set Task.ScaleToZero"},
				"request only, zero answer": {Task{Start: start, ScaleToZero: Unsupported("turn it off"), RequestOnly: Answer{}}, "set Task.RequestOnly"},
			} {
				t.Run(name, func(t *testing.T) {
					tc.task.Name = "new sweep"
					err := NewGroup(lifecycle).Start(t.Context(), tc.task)
					require.ErrorContains(t, err, `background task "new sweep" does not say what it does where`)
					assert.ErrorContains(t, err, tc.field)
				})
			}
		})
	}
}

func TestGroupRefusesALifecycleItDoesNotKnow(t *testing.T) {
	p := &probe{}
	err := NewGroup("serverless").Start(t.Context(), p.task(answersWhileUp))
	require.ErrorContains(t, err, `server.lifecycle is "serverless"`)
	assert.Zero(t, *p)
}

// Always on, a task starts its loop whatever it answers for the others.
func TestGroupAlwaysOnStartsTheLoop(t *testing.T) {
	for name, answer := range map[string]func(*probe) Answer{
		"while up":    answersWhileUp,
		"in request":  answersInRequest,
		"on trigger":  func(*probe) Answer { return OnTrigger(nil, "set a secret") },
		"unsupported": func(*probe) Answer { return Unsupported("turn it off") },
	} {
		for _, lifecycle := range []Lifecycle{"", AlwaysOn} {
			t.Run(name+"/"+string(lifecycle), func(t *testing.T) {
				p := &probe{}
				g := NewGroup(lifecycle)
				require.NoError(t, g.Start(t.Context(), p.task(answer)))
				assert.Equal(t, probe{started: 1}, *p)
				g.Close()
				assert.Equal(t, 1, p.stopped)
			})
		}
	}
}

// Each lifecycle follows its own answer and not the other's.
func TestGroupFollowsTheAnswerOfItsLifecycle(t *testing.T) {
	p := &probe{}
	task := Task{
		Name:        "probe",
		Start:       func(context.Context) error { p.started++; return nil },
		ScaleToZero: WhileUp(),
		RequestOnly: answersInRequest(p),
	}
	require.NoError(t, NewGroup(ScaleToZero).Start(t.Context(), task))
	assert.Equal(t, probe{started: 1}, *p)
	require.NoError(t, NewGroup(RequestOnly).Start(t.Context(), task))
	assert.Equal(t, probe{started: 1, inRequest: 1}, *p)
}

func TestGroupAnswers(t *testing.T) {
	for _, lifecycle := range []Lifecycle{ScaleToZero, RequestOnly} {
		t.Run(string(lifecycle), func(t *testing.T) {
			t.Run("in request runs the answer's start, not the loop", func(t *testing.T) {
				p := &probe{}
				g := NewGroup(lifecycle)
				require.NoError(t, g.Start(t.Context(), p.task(answersInRequest)))
				g.Close()
				assert.Equal(t, probe{inRequest: 1, stopped: 1}, *p)
			})
			t.Run("in request fails the start with the answer's error", func(t *testing.T) {
				p := &probe{}
				g := NewGroup(lifecycle)
				err := g.Start(t.Context(), p.task(func(*probe) Answer {
					return InRequest(func(context.Context) error { return errors.New("the wait is 0") })
				}))
				require.ErrorContains(t, err, "probe where server.lifecycle is "+string(lifecycle)+": the wait is 0")
				g.Close()
				assert.Zero(t, *p, "nothing started, nothing to stop")
			})
			t.Run("on trigger starts nothing", func(t *testing.T) {
				p := &probe{}
				g := NewGroup(lifecycle)
				require.NoError(t, g.Start(t.Context(), p.task(func(*probe) Answer { return OnTrigger(handler, "set a secret") })))
				g.Close()
				assert.Zero(t, *p, "the trigger's caller runs the task")
			})
			t.Run("on trigger without its trigger fails the start", func(t *testing.T) {
				p := &probe{}
				err := NewGroup(lifecycle).Start(t.Context(), p.task(func(*probe) Answer { return OnTrigger(nil, "set a secret") }))
				require.ErrorContains(t, err, "probe cannot run on a timer where server.lifecycle is "+string(lifecycle)+": set a secret")
				assert.Zero(t, *p)
			})
			t.Run("unsupported fails the start", func(t *testing.T) {
				p := &probe{}
				err := NewGroup(lifecycle).Start(t.Context(), p.task(func(*probe) Answer { return Unsupported("turn it off") }))
				require.ErrorContains(t, err, "probe cannot run where server.lifecycle is "+string(lifecycle)+": turn it off")
				assert.Zero(t, *p)
			})
		})
	}
	t.Run("while up starts the loop where instances come and go", func(t *testing.T) {
		p := &probe{}
		g := NewGroup(ScaleToZero)
		require.NoError(t, g.Start(t.Context(), p.task(answersWhileUp)))
		g.Close()
		assert.Equal(t, probe{started: 1, stopped: 1}, *p)
	})
	t.Run("a task that is off starts nowhere and fails nothing", func(t *testing.T) {
		for _, lifecycle := range Lifecycles {
			p := &probe{}
			task := p.task(func(*probe) Answer { return Unsupported("turn it off") })
			task.Disabled = true
			g := NewGroup(lifecycle)
			require.NoError(t, g.Start(t.Context(), task))
			g.Close()
			assert.Zero(t, *p)
		}
	})
}

func TestGroupFailsTheStartWithTheTasksError(t *testing.T) {
	task := Task{
		Name:        "event export",
		Start:       func(context.Context) error { return errors.New("unsupported sink") },
		Stop:        func() { t.Error("stopped a task that never started") },
		ScaleToZero: WhileUp(),
		RequestOnly: Unsupported("turn it off"),
	}
	for _, lifecycle := range []Lifecycle{AlwaysOn, ScaleToZero} {
		g := NewGroup(lifecycle)
		require.ErrorContains(t, g.Start(t.Context(), task), "start event export: unsupported sink")
		g.Close()
	}
}

func TestGroupStopsTheLastTaskFirst(t *testing.T) {
	var stopped []string
	g := NewGroup(AlwaysOn)
	for _, name := range []string{"first", "second"} {
		require.NoError(t, g.Start(t.Context(), Task{
			Name:        name,
			Start:       func(context.Context) error { return nil },
			Stop:        func() { stopped = append(stopped, name) },
			ScaleToZero: WhileUp(),
			RequestOnly: Unsupported("turn it off"),
		}))
	}
	g.Close()
	assert.Equal(t, []string{"second", "first"}, stopped)
}
