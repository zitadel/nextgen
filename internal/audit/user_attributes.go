package audit

import (
	"encoding/json"
	"sort"
)

// UserAttributeAuditFields builds attribute_keys and x-audit attribute values
// for user.created / user.updated payloads. Keys come from the written
// attributes. Values are included only when the matching top-level schema
// property has x-audit set (true or a non-empty string). When schemaJSON is
// empty or unparsable, keys are still returned and attributes is empty.
func UserAttributeAuditFields(user map[string]any, schemaJSON []byte) (keys []string, attributes map[string]any) {
	if len(user) == 0 {
		return nil, nil
	}
	keys = make([]string, 0, len(user))
	for k := range user {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return nil, nil
	}

	xAudit := xAuditKeysFromSchema(schemaJSON)
	if len(xAudit) == 0 {
		return keys, nil
	}
	attributes = make(map[string]any)
	for _, k := range keys {
		if !xAudit[k] {
			continue
		}
		attributes[k] = user[k]
	}
	if len(attributes) == 0 {
		return keys, nil
	}
	return keys, attributes
}

func xAuditKeysFromSchema(schemaJSON []byte) map[string]bool {
	if len(schemaJSON) == 0 {
		return nil
	}
	var root map[string]any
	if err := json.Unmarshal(schemaJSON, &root); err != nil {
		return nil
	}
	props, _ := root["properties"].(map[string]any)
	if len(props) == 0 {
		return nil
	}
	out := make(map[string]bool)
	for name, raw := range props {
		prop, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if isXAuditEnabled(prop["x-audit"]) {
			out[name] = true
		}
	}
	return out
}

func isXAuditEnabled(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return t != "" && t != "false"
	default:
		return false
	}
}
