package domain

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/maputil"
)

type AttributeKey string

func (k AttributeKey) Nodes() []string {
	return strings.Split(string(k), ".")
}

func (k AttributeKey) AppendNode(node string) AttributeKey {
	if len(k) == 0 {
		return AttributeKey(node)
	}
	return AttributeKey(string(k) + "." + node)
}

type Attribute struct {
	Key   AttributeKey `json:"key"`
	Value any          `json:"value"`
}

type AttributeUniqueness int

const (
	AttributeUniquenessUnspecified AttributeUniqueness = iota
	AttributeUniquenessTeam
	AttributeUniquenessProject
)

type CreateAttribute struct {
	Key         string              `json:"key"`
	Value       any                 `json:"value"`
	UniqueScope AttributeUniqueness `json:"unique_scope"`
	ValueHash   [sha256.Size]byte   `json:"value_hash"`
}

func NewCreateAttribute(key string, value any, unique AttributeUniqueness) (*CreateAttribute, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal attribute value: %w", err)
	}
	attr := &CreateAttribute{
		Key:         key,
		Value:       value,
		UniqueScope: unique,
	}
	if unique != AttributeUniquenessUnspecified {
		attr.ValueHash = sha256.Sum256(raw)
	}
	return attr, nil
}

func FlattenMapToCreateAttributes(m map[string]any, schema map[string]any, namePrefix string) ([]*CreateAttribute, error) {
	attrs := make([]*CreateAttribute, 0, len(m))
	for key, v := range m {
		var fullKey string
		if namePrefix != "" {
			fullKey = namePrefix + "." + key
		} else {
			fullKey = key
		}

		switch vv := v.(type) {
		case map[string]any:
			props, _ := maputil.GetNested[map[string]any](schema, "properties."+key)
			newAttrs, err := FlattenMapToCreateAttributes(vv, props, fullKey)
			if err != nil {
				return nil, err
			}
			attrs = append(attrs, newAttrs...)

		default:
			var unique AttributeUniqueness
			strUnique, _ := maputil.GetNested[string](schema, "properties."+key+".x-unique")
			switch strUnique {
			case "project":
				unique = AttributeUniquenessProject
			case "team":
				unique = AttributeUniquenessTeam
			}

			attr, err := NewCreateAttribute(fullKey, v, unique)
			if err != nil {
				return nil, err
			}
			attrs = append(attrs, attr)
		}
	}
	return attrs, nil
}

type Attributes []Attribute

func AttributesFromMap(m map[string]any) Attributes {
	attrs := make(Attributes, 0, len(m))
	attrs.fromMap(m, "")
	return attrs
}

// Get returns the value for the given key.
//
// TODO(go v27): make this method generic
func (attrs Attributes) Get(key AttributeKey) (value any, ok bool) {
	for _, attr := range attrs {
		if attr.Key == key {
			return attr.Value, true
		}
	}

	return nil, false
}

func (attrs *Attributes) fromMap(m map[string]any, keyPrefix AttributeKey) {
	for key, value := range m {
		fullKey := keyPrefix.AppendNode(key)

		switch tp := value.(type) {
		case map[string]any:
			attrs.fromMap(tp, fullKey)
		default:
			*attrs = append(*attrs, Attribute{Key: fullKey, Value: value})
		}
	}
}

func (attrs *Attributes) UnmarshalJSON(data []byte) error {
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return fmt.Errorf("attribute: %w", err)
	}

	*attrs = AttributesFromMap(m)
	return nil
}

func (attrs Attributes) ToMap() (map[string]any, error) {
	tree := make(map[string]any)
	for _, attr := range attrs {
		keyNodes := attr.Key.Nodes()

		subTree := tree
		for len(keyNodes) > 1 {
			// not a leaf node, traverse down the tree

			var m map[string]any
			v, ok := subTree[keyNodes[0]]
			if !ok {
				// nested map does not yet exist, create a new one
				m = make(map[string]any)
			} else if m, ok = v.(map[string]any); !ok {
				// if the key overlaps with another value which is not an object, error to be sure
				return nil, errors.New("the given key already exists in the map with a value which is not a map")
			}

			subTree[keyNodes[0]] = m
			subTree = m
			keyNodes = keyNodes[1:]
		}

		subTree[keyNodes[0]] = attr.Value

	}
	return tree, nil
}

func (attrs Attributes) MarshalJSON() ([]byte, error) {
	m, err := attrs.ToMap()
	if err != nil {
		return nil, err
	}
	return json.Marshal(m)
}
