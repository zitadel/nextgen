package harness

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"sync"
)

// poolSize bounds the concurrent requests provisioning and cleaning make. It
// is deliberately small: password hashing is the expensive part of creating a
// user, and the point is to finish in reasonable time, not to load the target.
const poolSize = 8

// forEach runs fn for every index in [0, n) on a bounded pool and returns the
// joined errors. It stops handing out work after the first failure or when ctx
// ends; work already started finishes.
func forEach(ctx context.Context, n int, fn func(ctx context.Context, i int) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		errs error
		next int
	)
	take := func() (int, bool) {
		mu.Lock()
		defer mu.Unlock()
		if next >= n || ctx.Err() != nil {
			return 0, false
		}
		i := next
		next++
		return i, true
	}
	for range min(poolSize, n) {
		wg.Go(func() {
			for {
				i, ok := take()
				if !ok {
					return
				}
				if err := fn(ctx, i); err != nil {
					mu.Lock()
					errs = errors.Join(errs, err)
					mu.Unlock()
					cancel()
					return
				}
			}
		})
	}
	wg.Wait()
	if errs == nil {
		return ctx.Err()
	}
	return errs
}

// sortUsers orders users by their position in index, which maps an address to
// its place in the fixture.
func sortUsers(users []ManifestUser, index map[string]int) {
	slices.SortFunc(users, func(a, b ManifestUser) int { return cmp.Compare(index[a.Email], index[b.Email]) })
}
