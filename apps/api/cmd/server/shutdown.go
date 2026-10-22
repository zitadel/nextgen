package server

import (
	"context"
	"errors"
)

type ShutdownFunc func(context.Context) error

type ShutdownFuncs struct {
	funcs []ShutdownFunc
}

func (sfs *ShutdownFuncs) Exec(ctx context.Context) error {
	var err error
	for i := len(sfs.funcs) - 1; i >= 0; i-- {
		err = errors.Join(err, sfs.funcs[i](ctx))
	}
	return err
}

func (sfs *ShutdownFuncs) Add(sf ShutdownFunc) {
	sfs.funcs = append(sfs.funcs, sf)
}
