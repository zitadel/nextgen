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

func (p *probe) task(answer func(*probe) Answer) Task {
	return Task{
		Name:         "probe",
		Start:        func(context.Context) error { p.started++; return nil },
		Stop:         func() { p.stopped++ },
		RequestBound: answer(p),
	}
}

func answersInRequest(p *probe) Answer {
	return InRequest(func(context.Context) error { p.inRequest++; return nil })
}

var handler = http.NotFoundHandler()

// A task that does not say what it does in a request-bound process fails the
// start in every process, so adding one cannot go unnoticed until it meets
// the deployment that pauses.
func TestGroupRefusesATaskWithoutAnAnswer(t *testing.T) {
	for name, requestBound := range map[string]bool{"a process that keeps running": false, "request bound": true} {
		t.Run(name, func(t *testing.T) {
			for name, task := range map[string]Task{
				"on":                   {Name: "new sweep", Start: func(context.Context) error { t.Error("started"); return nil }},
				"off":                  {Name: "new sweep", Disabled: true},
				"in request, no start": {Name: "new sweep", RequestBound: InRequest(nil)},
			} {
				t.Run(name, func(t *testing.T) {
					err := NewGroup(requestBound).Start(t.Context(), task)
					require.ErrorContains(t, err, `background task "new sweep" does not say what it does`)
					assert.ErrorContains(t, err, "Task.RequestBound")
				})
			}
		})
	}
}

func TestGroupStartsTheLoopInAProcessThatKeepsRunning(t *testing.T) {
	for name, answer := range map[string]func(*probe) Answer{
		"in request":  answersInRequest,
		"on trigger":  func(*probe) Answer { return OnTrigger(nil, "set a secret") },
		"unsupported": func(*probe) Answer { return Unsupported("turn it off") },
	} {
		t.Run(name, func(t *testing.T) {
			p := &probe{}
			g := NewGroup(false)
			require.NoError(t, g.Start(t.Context(), p.task(answer)))
			assert.Equal(t, probe{started: 1}, *p)
			g.Close()
			assert.Equal(t, 1, p.stopped)
		})
	}
}

func TestGroupRequestBound(t *testing.T) {
	t.Run("in request runs the answer's start, not the loop", func(t *testing.T) {
		p := &probe{}
		g := NewGroup(true)
		require.NoError(t, g.Start(t.Context(), p.task(answersInRequest)))
		g.Close()
		assert.Equal(t, probe{inRequest: 1, stopped: 1}, *p)
	})
	t.Run("in request fails the start with the answer's error", func(t *testing.T) {
		p := &probe{}
		g := NewGroup(true)
		err := g.Start(t.Context(), p.task(func(*probe) Answer {
			return InRequest(func(context.Context) error { return errors.New("the wait is 0") })
		}))
		require.ErrorContains(t, err, "probe where server.request_bound is set: the wait is 0")
		g.Close()
		assert.Zero(t, *p, "nothing started, nothing to stop")
	})
	t.Run("on trigger starts nothing", func(t *testing.T) {
		p := &probe{}
		g := NewGroup(true)
		require.NoError(t, g.Start(t.Context(), p.task(func(*probe) Answer { return OnTrigger(handler, "set a secret") })))
		g.Close()
		assert.Zero(t, *p, "the trigger's caller runs the task")
	})
	t.Run("on trigger without its trigger fails the start", func(t *testing.T) {
		p := &probe{}
		err := NewGroup(true).Start(t.Context(), p.task(func(*probe) Answer { return OnTrigger(nil, "set a secret") }))
		require.ErrorContains(t, err, "probe cannot run on a timer where server.request_bound is set: set a secret")
		assert.Zero(t, *p)
	})
	t.Run("unsupported fails the start", func(t *testing.T) {
		p := &probe{}
		err := NewGroup(true).Start(t.Context(), p.task(func(*probe) Answer { return Unsupported("turn it off") }))
		require.ErrorContains(t, err, "probe cannot run where server.request_bound is set: turn it off")
		assert.Zero(t, *p)
	})
	t.Run("a task that is off starts nowhere and fails nothing", func(t *testing.T) {
		for _, requestBound := range []bool{false, true} {
			p := &probe{}
			task := p.task(func(*probe) Answer { return Unsupported("turn it off") })
			task.Disabled = true
			g := NewGroup(requestBound)
			require.NoError(t, g.Start(t.Context(), task))
			g.Close()
			assert.Zero(t, *p)
		}
	})
}

func TestGroupFailsTheStartWithTheTasksError(t *testing.T) {
	task := Task{
		Name:         "event export",
		Start:        func(context.Context) error { return errors.New("unsupported sink") },
		Stop:         func() { t.Error("stopped a task that never started") },
		RequestBound: Unsupported("turn it off"),
	}
	g := NewGroup(false)
	require.ErrorContains(t, g.Start(t.Context(), task), "start event export: unsupported sink")
	g.Close()
}

func TestGroupStopsTheLastTaskFirst(t *testing.T) {
	var stopped []string
	g := NewGroup(false)
	for _, name := range []string{"first", "second"} {
		require.NoError(t, g.Start(t.Context(), Task{
			Name:         name,
			Start:        func(context.Context) error { return nil },
			Stop:         func() { stopped = append(stopped, name) },
			RequestBound: Unsupported("turn it off"),
		}))
	}
	g.Close()
	assert.Equal(t, []string{"second", "first"}, stopped)
}
