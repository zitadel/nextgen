package harness

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
)

func TestForEachRunsEveryIndexWithinTheBound(t *testing.T) {
	var running, peak, done atomic.Int32
	err := forEach(t.Context(), 100, func(context.Context, int) error {
		n := running.Add(1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		running.Add(-1)
		done.Add(1)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if done.Load() != 100 {
		t.Errorf("ran %d of 100", done.Load())
	}
	if peak.Load() > poolSize {
		t.Errorf("%d concurrent, bound is %d", peak.Load(), poolSize)
	}
}

func TestForEachStopsHandingOutWorkAfterAFailure(t *testing.T) {
	boom := errors.New("boom")
	var started atomic.Int32
	err := forEach(t.Context(), 10_000, func(context.Context, int) error {
		started.Add(1)
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if started.Load() > 2*poolSize {
		t.Errorf("kept going after the first failure: %d started", started.Load())
	}
}

func TestForEachEmpty(t *testing.T) {
	if err := forEach(t.Context(), 0, func(context.Context, int) error { t.Fatal("called"); return nil }); err != nil {
		t.Fatal(err)
	}
}
