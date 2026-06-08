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
	for _, sf := range sfs.funcs {
		err = errors.Join(err, sf(ctx))
	}
	return err
}

func (sfs *ShutdownFuncs) Add(sf ShutdownFunc) {
	sfs.funcs = append(sfs.funcs, sf)
}
