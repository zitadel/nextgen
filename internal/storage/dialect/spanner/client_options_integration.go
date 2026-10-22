//go:build spanner_integration

package spanner

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"strconv"
	"sync"

	"google.golang.org/api/option"

	"github.com/zitadel/nextgen/internal/storage/testdb/spannerabort"
)

// The abort injector's settings. Release builds do not set the
// spanner_integration tag, so they never compile this file.
const (
	abortRateEnv     = "ZITADEL_TEST_SPANNER_ABORT_RATE"
	abortSeedEnv     = "ZITADEL_TEST_SPANNER_ABORT_SEED"
	defaultAbortRate = 0.1
)

// clientOptions gives every Spanner client in an integration build the abort
// injector, which aborts a seeded share of read-write calls so that test
// transactions go through the retry path whatever engine they run against
// (#788). A transaction makes several eligible calls, so at the default rate
// roughly a quarter to a third of them are retried at least once.
func clientOptions() ([]option.ClientOption, error) {
	in, err := abortInjector()
	if err != nil || in == nil {
		return nil, err
	}
	var opts []option.ClientOption
	for _, o := range in.DialOptions() {
		opts = append(opts, option.WithGRPCDialOption(o))
	}
	return opts, nil
}

// abortInjector is built once per process, so every client in a test package
// shares one seed and the seed is logged once.
var abortInjector = sync.OnceValues(func() (*spannerabort.Injector, error) {
	rate := defaultAbortRate
	if v := os.Getenv(abortRateEnv); v != "" {
		r, err := strconv.ParseFloat(v, 64)
		// Below 1: at 1 every attempt aborts, and a transaction retries until its
		// budget runs out.
		if err != nil || !(r >= 0 && r < 1) {
			return nil, fmt.Errorf("%s must be a number from 0 up to, not including, 1; got %q", abortRateEnv, v)
		}
		rate = r
	}
	if rate == 0 {
		return nil, nil
	}
	seed := rand.Uint64()
	if v := os.Getenv(abortSeedEnv); v != "" {
		s, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("%s must be an unsigned integer; got %q", abortSeedEnv, v)
		}
		seed = s
	}
	slog.Info("spanner abort injection on", "rate", rate, "seed", seed,
		"replay_with", abortSeedEnv+"="+strconv.FormatUint(seed, 10))
	return spannerabort.New(rate, seed), nil
})
