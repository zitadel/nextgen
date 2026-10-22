package idgen

import "fmt"

// Ensure assigns a managed ID when *id is empty; non-empty values are kept.
func Ensure(id *string, prefix string, g Generator) error {
	if id == nil {
		return fmt.Errorf("managed id pointer is nil")
	}
	if *id != "" {
		return nil
	}
	generated, err := g.New(prefix)
	if err != nil {
		return fmt.Errorf("generate %s id: %w", prefix, err)
	}
	*id = generated
	return nil
}
