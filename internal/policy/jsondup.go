package policy

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// rejectDuplicateKeys fails when any object in the document repeats a key,
// compared without case. encoding/json keeps the last of duplicates
// silently and matches struct fields without case, so a merge leftover such
// as `"min_length": 15, "min_length": 8`, or `"config": {...}` followed by
// `"Config": {}`, would otherwise weaken the policy without a word.
func rejectDuplicateKeys(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	// One frame per open object or array; objects track their keys and
	// whether the next string token is a key.
	type frame struct {
		keys      map[string]struct{}
		expectKey bool
	}
	var stack []*frame
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		var top *frame
		if len(stack) > 0 {
			top = stack[len(stack)-1]
		}
		switch t := tok.(type) {
		case json.Delim:
			switch t {
			case '{':
				if top != nil && top.keys != nil {
					top.expectKey = true
				}
				stack = append(stack, &frame{keys: map[string]struct{}{}, expectKey: true})
			case '[':
				if top != nil && top.keys != nil {
					top.expectKey = true
				}
				stack = append(stack, &frame{})
			case '}', ']':
				stack = stack[:len(stack)-1]
			}
		default:
			if top == nil || top.keys == nil {
				continue // a value inside an array, or a top-level scalar
			}
			if !top.expectKey {
				top.expectKey = true // a value; the next string is a key
				continue
			}
			key, _ := tok.(string)
			folded := strings.ToLower(key)
			if _, dup := top.keys[folded]; dup {
				return fmt.Errorf("duplicate key %q", key)
			}
			top.keys[folded] = struct{}{}
			top.expectKey = false
		}
	}
}
