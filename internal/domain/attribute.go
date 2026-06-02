package domain

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/maputil"
)

type Attribute struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

type Attributes []Attribute

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

func BuildAttributeTree(attributes []Attribute) (map[string]any, error) {
	tree := make(map[string]any)
	for i, a := range attributes {
		keyNodes := strings.Split(a.Key, ".")

		// empty keys are prevented in the DB schema,
		// this is just a safety check to prevent panics in case of invalid data
		if keyNodes[0] == "" {
			return nil, fmt.Errorf("illegal empty key for attribute at index %d", i)
		}

		setAttribute(keyNodes, a.Value, tree)
	}
	return tree, nil
}

func setAttribute(keyNodes []string, value any, tree map[string]any) {
	// leaf node, set the value
	if len(keyNodes) == 1 {
		tree[keyNodes[0]] = value
		return
	}

	// not a leaf node, traverse down the tree
	subTree, ok := tree[keyNodes[0]].(map[string]any)
	if !ok {
		subTree = make(map[string]any)
		tree[keyNodes[0]] = subTree
	}
	setAttribute(keyNodes[1:], value, subTree)
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
