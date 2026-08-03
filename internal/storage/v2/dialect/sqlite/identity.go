package sqlite

import (
	"fmt"
	"strconv"
)

func parseIdentity(id string) (int64, error) {
	parsed, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid identity %q: %w", id, err)
	}
	return parsed, nil
}
