// Package service is the fixture's entry-point package: FixtureService is the
// *Service interface the analysis starts from.
//
// It pins the shapes the production tree does not happen to contain, so a
// refactor that introduces one does not discover them the hard way — as an
// operation quietly shipping a smaller error set than it can return.
package service

import (
	"errors"

	"github.com/zitadel/nextgen/api/internal/erroranalysis/testdata/fixture/domain"
)

type FixtureService interface {
	AsPointerTarget() error
	AsInCondition() error
	AsTypeFirstResult() error
	MutualA() error
	MutualB() error
}

type fixtureService struct {
	branch bool
}

func NewFixtureService() FixtureService { return &fixtureService{} }

func (s *fixtureService) inner() error { return domain.ErrFixtureInner() }

// AsPointerTarget assigns the call's result, so the first LHS is the bool and
// the error lands in the second argument's pointee.
func (s *fixtureService) AsPointerTarget() error {
	err := s.inner()

	var target *domain.Error
	if ok := errors.As(err, &target); ok {
		return target
	}
	return domain.ErrFixtureOuter()
}

// AsInCondition never assigns the call at all — the only place the unwrap
// appears is an if condition.
func (s *fixtureService) AsInCondition() error {
	err := s.inner()

	var target *domain.Error
	if errors.As(err, &target) {
		return target
	}
	return domain.ErrFixtureOuter()
}

// AsTypeFirstResult is the idiom the production code uses, kept alongside so a
// change to one form cannot silently break the other.
func (s *fixtureService) AsTypeFirstResult() error {
	err := s.inner()

	if target, ok := errors.AsType[*domain.Error](err); ok {
		return target
	}
	return domain.ErrFixtureOuter()
}

// MutualA and mutualB close a cycle. Analyzing MutualA leaves mutualB's call
// back into it contributing nothing, so mutualB's set is missing A's own error
// — correct for that walk, wrong to keep. Caching it would hand the truncated
// set to MutualB and to every later caller.
func (s *fixtureService) MutualA() error {
	if s.branch {
		return domain.ErrFixtureA()
	}
	return s.mutualB()
}

// MutualB reaches the same cycle from the other side, after MutualA has been
// analyzed — so it is the one that reads a poisoned cache entry.
func (s *fixtureService) MutualB() error {
	return s.mutualB()
}

func (s *fixtureService) mutualB() error {
	if s.branch {
		return domain.ErrFixtureB()
	}
	return s.MutualA()
}
