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
	abortsEnv    = "ZITADEL_TEST_SPANNER_ABORTS"
	abortSeedEnv = "ZITADEL_TEST_SPANNER_ABORT_SEED"
	abortRate    = 0.1
)

// clientOptions gives every Spanner client in an integration build the abort
// injector, which aborts a seeded share of read-write transactions so that they
// go through the retry path whatever engine they run against (#788). An attempt
// gets at most two draws, so about one in five is aborted, however many
// statements it runs.
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
// shares one seed and the seed is logged once. ZITADEL_TEST_SPANNER_ABORTS=false
// turns it off.
var abortInjector = sync.OnceValues(func() (*spannerabort.Injector, error) {
	if v := os.Getenv(abortsEnv); v != "" {
		on, err := strconv.ParseBool(v)
		if err != nil {
			return nil, fmt.Errorf("%s must be true or false; got %q", abortsEnv, v)
		}
		if !on {
			return nil, nil
		}
	}
	seed := rand.Uint64()
	if v := os.Getenv(abortSeedEnv); v != "" {
		s, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("%s must be an unsigned integer; got %q", abortSeedEnv, v)
		}
		seed = s
	}
	slog.Info("spanner abort injection on", "rate", abortRate, "seed", seed,
		"replay_with", abortSeedEnv+"="+strconv.FormatUint(seed, 10))
	return spannerabort.New(abortRate, seed), nil
})
