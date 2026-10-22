package zlog

import "sync/atomic"

var addSourceEnabled atomic.Bool

func IsAddSourceEnabled() bool {
	return addSourceEnabled.Load()
}
