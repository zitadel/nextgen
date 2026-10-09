package idgen

import "fmt"

// normalizePrefix rejects empty prefixes and strips a trailing underscore so
// "user" and "user_" mint the same "user_<opaque>" form.
func normalizePrefix(prefix string) (string, error) {
	if prefix == "" {
		return "", fmt.Errorf("idgen: prefix must not be empty")
	}
	if prefix[len(prefix)-1] == '_' {
		prefix = prefix[:len(prefix)-1]
	}
	return prefix, nil
}
