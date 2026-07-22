package domain

// IsSensitiveProperty reports whether a JSON Schema property is marked sensitive.
// The canonical extension in this repo is x-sensitive (see user-property.yaml).
func IsSensitiveProperty(propertySchema map[string]any) bool {
	if propertySchema == nil {
		return false
	}
	if v, ok := propertySchema["x-sensitive"]; ok {
		switch t := v.(type) {
		case bool:
			return t
		case float64:
			return t != 0
		}
	}
	return false
}
