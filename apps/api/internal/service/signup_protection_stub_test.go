package service_test

import (
	"context"

	"github.com/zitadel/nextgen/internal/crypto/pow"
	"github.com/zitadel/nextgen/internal/domain"
)

type stubSignupProtection struct{ err error }

func (s stubSignupProtection) Challenge(context.Context, *domain.FlowState) (*pow.PublicChallenge, error) {
	return nil, s.err
}
func (s stubSignupProtection) Consume(context.Context, *domain.FlowState, string) error { return s.err }
