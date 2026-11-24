package service_test

import (
	"context"

	"github.com/zitadel/nextgen/internal/crypto/pow"
	"github.com/zitadel/nextgen/internal/flowengine"
)

type stubSignupProtection struct{ err error }

func (s stubSignupProtection) Challenge(context.Context, *flowengine.FlowState) (*pow.PublicChallenge, error) {
	return nil, s.err
}
func (s stubSignupProtection) Consume(context.Context, *flowengine.FlowState, string) error {
	return s.err
}
