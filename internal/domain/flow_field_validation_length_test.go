package domain_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestFlowFieldValidationCountsCodePointsNotBytes(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := domain.FlowResolvedFields{Fields: []domain.FlowField{{
		Name:       "pw",
		Type:       domain.FlowFieldTypePassword,
		Validation: &domain.FlowFieldValidation{MinLength: 8, MaxLength: 10},
	}}}
	// パスワード is 5 code points and 15 bytes: below the minimum.
	if err := resolver.Validate(fields, map[string]any{"pw": "パスワード"}); err == nil {
		t.Fatal("5 code points passed a minimum of 8; length was counted in bytes")
	}
	// 9 code points, 27 bytes: within 8..10.
	if err := resolver.Validate(fields, map[string]any{"pw": "パスワードパスワパ"}); err != nil {
		t.Fatalf("9 code points rejected: %v", err)
	}
}
