package domain

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type flowUserWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUser) error
}

type flowUserPasswordWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, password *CreateUserPassword) error
}

// FlowCreateUserHandler implements the `create_user` on_success:
// persist a new user from validated identifier + password fields.
type FlowCreateUserHandler struct {
	ids       idgen.Generator
	users     flowUserWriter
	passwords flowUserPasswordWriter
	hasher    FlowPasswordHasher
}

func NewFlowCreateUserHandler(ids idgen.Generator, users flowUserWriter, passwords flowUserPasswordWriter, hasher FlowPasswordHasher) *FlowCreateUserHandler {
	return &FlowCreateUserHandler{ids: ids, users: users, passwords: passwords, hasher: hasher}
}

var _ FlowOnSuccessHandler = (*FlowCreateUserHandler)(nil)

func (h *FlowCreateUserHandler) Handle(ctx context.Context, client database.QueryExecutor, in FlowOnSuccessInput) (FlowOnSuccessResult, error) {
	identifierName, _, ok := findIdentifierField(in.Resolved.Fields, in.Fields)
	if !ok {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: create_user step has no identifier field", ErrIntegrity)
	}
	_, passwordValue, hasPassword := findPasswordField(in.Resolved.Fields, in.Fields)
	if !hasPassword {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: create_user step has no password field", ErrIntegrity)
	}

	userID, err := h.ids.New("user")
	if err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: generate id: %w", err)
	}

	attrs := make([]*CreateAttribute, 0, len(in.Fields))
	for name, value := range in.Fields {
		field, known := in.Resolved.Fields[name]
		if !known || field.Challenge == FlowFieldChallengePassword {
			continue
		}
		uniqueScope := attributeUniquenessFor(name, identifierName, field.Unique)
		attr, err := NewCreateAttribute(name, value, uniqueScope)
		if err != nil {
			return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: build attribute %q: %w", name, err)
		}
		attrs = append(attrs, attr)
	}

	encodedHash, err := h.hasher.Hash(asString(passwordValue))
	if err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: hash password: %w", err)
	}

	if err := h.users.Create(ctx, client, &CreateUser{
		ProjectID:  in.ProjectID,
		SchemaURL:  in.UserSchemaURL,
		ID:         userID,
		Attributes: attrs,
	}); err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: insert user: %w", err)
	}

	if err := h.passwords.Create(ctx, client, &CreateUserPassword{
		ProjectID:   in.ProjectID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}); err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: insert password: %w", err)
	}

	return FlowOnSuccessResult{UserID: userID}, nil
}

func findIdentifierField(resolved map[string]FlowField, submitted map[string]any) (name string, value any, ok bool) {
	for n, f := range resolved {
		if f.Challenge == FlowFieldChallengeIdentifier {
			return n, submitted[n], true
		}
	}
	return "", nil, false
}

func findPasswordField(resolved map[string]FlowField, submitted map[string]any) (name string, value any, ok bool) {
	for n, f := range resolved {
		if f.Challenge == FlowFieldChallengePassword {
			return n, submitted[n], true
		}
	}
	return "", nil, false
}

// attributeUniquenessFor maps a [FlowFieldUniqueScope] to the
// [AttributeUniqueness] the user repository understands. The
// identifier field defaults to team-level uniqueness so two users
// can't share the same login.
func attributeUniquenessFor(name, identifierName string, scope FlowFieldUniqueScope) AttributeUniqueness {
	switch scope {
	case FlowFieldUniqueScopeInstance:
		return AttributeUniquenessProject
	case FlowFieldUniqueScopeOrganization:
		return AttributeUniquenessTeam
	}
	if name == identifierName {
		return AttributeUniquenessTeam
	}
	return AttributeUniquenessUnspecified
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}
