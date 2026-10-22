// Package domain stands in for internal/domain in the errors.As fixture: it
// declares the ErrXxx constructors and the Error type the analysis keys on.
//
// It lives under testdata so the go tool leaves it out of ./... — it exists
// only to be loaded by name from erroranalysis_test.go.
package domain

type Error struct {
	code string
}

func (e *Error) Error() string { return e.code }

func ErrFixtureInner() error { return &Error{code: "fixture.inner"} }

func ErrFixtureOuter() error { return &Error{code: "fixture.outer"} }

func ErrFixtureA() error { return &Error{code: "fixture.a"} }

func ErrFixtureB() error { return &Error{code: "fixture.b"} }
