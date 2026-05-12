package convert

import (
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/go-faster/jx"
	"github.com/google/jsonschema-go/jsonschema"
	api "github.com/zitadel/nextgen/api/generated"
)

func JsonschemaToUserSchema(in *jsonschema.Schema) (out *api.UserSchema, err error) {
	out = &api.UserSchema{
		Schema:   in.Schema,
		Title:    in.Title,
		Required: in.Required[:],
	}

	id, err := url.Parse(in.ID)
	if err != nil {
		return nil, err
	}
	out.ID = *id

	if in.Type != "" {
		out.Type.SetTo(in.Type)
	}
	if in.Description != "" {
		out.Description.SetTo(in.Description)
	}

	if in.Extra != nil {
		if err = mapExtras(in.Extra, out); err != nil {
			return nil, err
		}
	}

	if in.Properties != nil {
		properties, err := propertiesToApiProperties(in.Properties)
		if err != nil {
			return nil, err
		}
		if properties != nil {
			out.Properties.SetTo(properties)
		}
	}

	return out, nil
}

func mapExtras(in map[string]any, out *api.UserSchema) error {
	kind, err := getMapAnyProperty[string](in, "kind")
	if err != nil {
		return err
	}
	if kind != nil {
		out.Kind = *kind
	}

	authMethodsMap, err := getMapAnyProperty[map[string]any](in, "x-auth-methods")
	if err != nil {
		return err
	}
	if authMethodsMap != nil {
		authMethods, err := mapToAuthMethods(*authMethodsMap)
		if err != nil {
			return err
		}
		out.XMinusAuthMinusMethods = *authMethods
	}

	return nil
}

func propertiesToApiProperties(in map[string]*jsonschema.Schema) (api.UserSchemaProperties, error) {
	out := api.UserSchemaProperties{}

	for k, v := range in {
		if v == nil {
			out[k] = jx.Raw("null")
			continue
		}
		raw, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		out[k] = raw
	}

	return out, nil
}

func getMapAnyProperty[T any](m map[string]any, key string) (*T, error) {
	a, ok := m[key]
	if !ok {
		return nil, nil
	}
	v, ok := a.(T)
	if !ok {
		return nil, NewInvalidTypecastError[T](a, key)
	}
	return &v, nil
}

func mapToAuthMethods(in map[string]any) (*api.AuthMethods, error) {
	out := &api.AuthMethods{}

	methods := []struct {
		key    string
		setter func(method api.AuthMethod)
	}{
		{
			key: "password",
			setter: func(method api.AuthMethod) {
				out.Password.SetTo(method)
			},
		},
		{
			key: "passkey",
			setter: func(method api.AuthMethod) {
				out.Passkey.SetTo(method)
			},
		},
		{
			key: "magic_link",
			setter: func(method api.AuthMethod) {
				out.MagicLink.SetTo(method)
			},
		},
		{
			key: "sso",
			setter: func(method api.AuthMethod) {
				out.SSO.SetTo(method)
			},
		},
		{
			key: "otp",
			setter: func(method api.AuthMethod) {
				out.Otp.SetTo(method)
			},
		},
	}
	for _, method := range methods {
		authMethodMap, err := getMapAnyProperty[map[string]any](in, method.key)
		if err != nil {
			return nil, err
		}
		if authMethodMap == nil {
			continue
		}

		authMethod, err := mapToAuthMethod(*authMethodMap)
		if err != nil {
			return nil, err
		}
		if authMethod != nil {
			method.setter(*authMethod)
		}
	}

	return out, nil
}

func mapToAuthMethod(in map[string]any) (*api.AuthMethod, error) {
	out := &api.AuthMethod{}

	enabled, err := getMapAnyProperty[bool](in, "enabled")
	if err != nil {
		return nil, err
	}
	if enabled != nil {
		out.Enabled = *enabled
	}

	position, err := getMapAnyProperty[int](in, "position")
	if err != nil {
		return nil, err
	}
	if position != nil {
		out.Position = *position
	}

	return out, nil
}

// ----------------- ERRORS ------------------------

type InvalidTypecastError struct {
	Value    any
	Target   any
	Property string
}

func NewInvalidTypecastError[T any](value any, property string) *InvalidTypecastError {
	return &InvalidTypecastError{
		Value:    value,
		Target:   *new(T),
		Property: property,
	}
}

func (e *InvalidTypecastError) Error() string {
	return fmt.Sprintf("cannot typecast %s (%v is no %t)", e.Property, e.Value, e.Target)
}
