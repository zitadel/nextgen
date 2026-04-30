package domain

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserInstancePayload struct {
	InstanceID string          `json:"instance_id"`
	SchemaURL  string          `json:"schema_url"`
	Payload    json.RawMessage `json:"payload"`
}
type TenantUserInstanceValidator struct {
	resolver *JSONSchemaResolver
}

func NewTenantUserInstanceValidator(resolver *JSONSchemaResolver) *TenantUserInstanceValidator {
	return &TenantUserInstanceValidator{resolver: resolver}
}

// ValidateUserInstance validates the user instance against the tenant user schema.
func (u *TenantUserInstanceValidator) ValidateUserInstance(ctx context.Context, client database.QueryExecutor, userInstance *UserInstancePayload) error {
	if userInstance == nil {
		return fmt.Errorf("user instance is nil")
	}
	tenantSchema, err := u.resolver.Resolve(ctx, client, userInstance.InstanceID, userInstance.SchemaURL, JSONSchemaResolverOptions{})
	if err != nil {
		return fmt.Errorf("failed to resolve tenant schema: %w", err)
	}
	var instance any
	if err := json.Unmarshal(userInstance.Payload, &instance); err != nil {
		return fmt.Errorf("invalid user payload: %w", err)
	}
	if err := tenantSchema.Validate(instance); err != nil {
		return fmt.Errorf("invalid user instance: %w", err)
	}
	return nil
}
