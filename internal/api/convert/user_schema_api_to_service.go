package convert

import (
	"github.com/go-faster/jx"
	"github.com/google/jsonschema-go/jsonschema"
	api "github.com/zitadel/nextgen/api/generated"
)

func UserSchemaToJsonschema(in api.UserSchema) (out *jsonschema.Schema, err error) {
	out = &jsonschema.Schema{
		ID:          in.ID,
		Schema:      in.Schema,
		Title:       in.Title,
		Type:        in.Type.Value,
		Required:    in.Required[:],
		Description: in.Description.Value,
		Properties:  make(map[string]*jsonschema.Schema, len(in.Properties.Value)),
		Extra: map[string]any{
			"kind":           in.Kind,
			"x-auth-methods": authMethodsToMap(in.XMinusAuthMinusMethods),
		},
	}

	for name, prop := range in.Properties.Value {
		out.Properties[name], err = rawToSchema(prop)
	}

	return out, err
}

func authMethodsToMap(in api.AuthMethods) map[string]any {
	out := make(map[string]any, 5)

	if in.Password.Set {
		out["password"] = optAuthMethodToMap(in.Password)
	}
	if in.Passkey.Set {
		out["passkey"] = optAuthMethodToMap(in.Passkey)
	}
	if in.MagicLink.Set {
		out["magic_link"] = optAuthMethodToMap(in.MagicLink)
	}
	if in.SSO.Set {
		out["sso"] = optAuthMethodToMap(in.SSO)
	}
	if in.Otp.Set {
		out["otp"] = optAuthMethodToMap(in.Otp)
	}

	return out
}

func optAuthMethodToMap(in api.OptAuthMethod) map[string]any {
	if !in.Set {
		return nil
	}
	return map[string]any{
		"enable":   in.Value.Enabled,
		"position": in.Value.Position,
	}
}

func rawToSchema(in jx.Raw) (*jsonschema.Schema, error) {
	if in == nil || string(in) == "null" {
		return nil, nil
	}

	schema := &jsonschema.Schema{}
	err := schema.UnmarshalJSON(in)
	if err != nil {
		return nil, err
	}

	return schema, nil
}
