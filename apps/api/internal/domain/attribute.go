package domain

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"

	"golang.org/x/text/cases"

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
		if err := maputil.SetNested(tree, attr.Key.Nodes(), attr.Value); err != nil {
			return nil, err
		}
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

// MergeAttributesPatch merges patch into current with RFC 7386 semantics:
// an omitted key stays untouched, an object merges recursively, nil deletes
// the key, and any other value replaces the stored one. Neither input is
// mutated. An object that merges down to no keys is kept as an empty map;
// the EAV flattening then stores nothing for it, same as on create.
func MergeAttributesPatch(current, patch map[string]any) map[string]any {
	merged := maps.Clone(current)
	if merged == nil {
		merged = make(map[string]any, len(patch))
	}
	for key, value := range patch {
		switch typed := value.(type) {
		case nil:
			delete(merged, key)
		case map[string]any:
			sub, _ := merged[key].(map[string]any)
			merged[key] = MergeAttributesPatch(sub, typed)
		default:
			merged[key] = value
		}
	}
	return merged
}

// UniqueTeamScopes resolves the unique team scope of each attribute, index
// aligned with attrs: project-unique values are project-wide (""), team-unique
// values keep their already-stored scope when preserved knows the key and fall
// back to fallback otherwise. Entries for non-unique attributes stay "" and go
// unused. Pass a nil preserved map when nothing is stored yet (create).
func (attrs CreateAttributes) UniqueTeamScopes(preserved map[AttributeKey]string, fallback string) []string {
	scopes := make([]string, len(attrs))
	for i, a := range attrs {
		if a.UniqueScope != AttributeUniquenessTeam {
			continue
		}
		if team, ok := preserved[a.Key]; ok {
			scopes[i] = team
			continue
		}
		scopes[i] = fallback
	}
	return scopes
}

type CreateAttribute struct {
	Key         AttributeKey        `json:"key"`
	Value       any                 `json:"value"`
	UniqueScope AttributeUniqueness `json:"unique_scope"`
	ValueHash   [sha256.Size]byte   `json:"value_hash"`
	// SearchText is what a prefix search compares for this attribute (see
	// [SearchText]). Nil for an attribute no search reads: only the ones
	// [CreateAttributes.MarkSearchable] names carry it.
	SearchText *string `json:"-"`
}

func NewCreateAttribute(key AttributeKey, value any, unique AttributeUniqueness) (*CreateAttribute, error) {
	attr := &CreateAttribute{
		Key:         key,
		Value:       value,
		UniqueScope: unique,
	}
	if unique != AttributeUniquenessUnspecified {
		hash, err := UniqueValueHash(value)
		if err != nil {
			return nil, err
		}
		attr.ValueHash = hash
	} else if _, err := json.Marshal(value); err != nil {
		// UniqueValueHash marshals on the unique path; keep the same
		// marshalability guarantee for non-unique values.
		return nil, fmt.Errorf("failed to marshal attribute value: %w", err)
	}
	return attr, nil
}

// UniqueValueHash is the one comparison function behind attribute uniqueness:
// the unique index stores it and identifier resolution looks it
// up, so both always agree on what counts as the same value (ADR 058 §4a).
// String values are Unicode case-folded before hashing — Alice@Example.com
// and alice@example.com are one unique value — while the attribute itself
// keeps its original casing. Non-string values hash as encoded.
func UniqueValueHash(value any) ([sha256.Size]byte, error) {
	if s, ok := value.(string); ok {
		value = cases.Fold().String(s)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return [sha256.Size]byte{}, fmt.Errorf("failed to marshal attribute value: %w", err)
	}
	return sha256.Sum256(raw), nil
}

// SearchTextMaxRunes caps the text an attribute is searched by. The text is an
// index key, which every database limits in size, and a prefix search reads
// only the start of a value.
const SearchTextMaxRunes = 256

// SearchText is the text a prefix search compares for an attribute value, and
// for the term searched for: the value under the Unicode case folding
// [UniqueValueHash] uses, cut to [SearchTextMaxRunes]. A value and a term
// therefore agree on case exactly as uniqueness does. It reports false for a
// value that is not a string or folds to nothing, which no search can match.
func SearchText(value any) (string, bool) {
	s, ok := value.(string)
	if !ok {
		return "", false
	}
	folded := cases.Fold().String(s)
	if cut := runeOffset(folded, SearchTextMaxRunes); cut < len(folded) {
		folded = folded[:cut]
	}
	return folded, folded != ""
}

// runeOffset is the byte offset after the first n runes of s, or len(s) when s
// holds fewer.
func runeOffset(s string, n int) int {
	for offset := range s {
		if n == 0 {
			return offset
		}
		n--
	}
	return len(s)
}

// SearchableAttributeKeys are the properties of a user schema a search reads:
// the designated identifier and the display parts (ADR 058 §1 and §2).
func SearchableAttributeKeys(schema map[string]any) []AttributeKey {
	var keys []AttributeKey
	if identifier, _ := schema[SchemaAnnotationIdentifier].(string); identifier != "" {
		keys = append(keys, AttributeKey(identifier))
	}
	display, _ := schema[SchemaAnnotationDisplay].([]any)
	for _, entry := range display {
		if path, _ := entry.(string); path != "" {
			keys = append(keys, AttributeKey(path))
		}
	}
	return keys
}

// MarkSearchable sets the search text of the attributes keys names, in place.
// An attribute whose value has no search text (see [SearchText]) stays
// unmarked.
func (attrs CreateAttributes) MarkSearchable(keys []AttributeKey) {
	for i := range attrs {
		if !slices.Contains(keys, attrs[i].Key) {
			continue
		}
		if text, ok := SearchText(attrs[i].Value); ok {
			attrs[i].SearchText = &text
		}
	}
}

type CreateAttributes []CreateAttribute

func CreateAttributesFromMap(m map[string]any, schema map[string]any) (CreateAttributes, error) {
	attrs := make(CreateAttributes, 0, len(m))
	err := attrs.fromMap(m, schema, "")
	if err != nil {
		return nil, err
	}
	return attrs, nil
}

// Get returns the value for the given key.
//
// TODO(go v27): make this method generic
func (attrs CreateAttributes) Get(key AttributeKey) (value *CreateAttribute, ok bool) {
	for _, attr := range attrs {
		if attr.Key == key {
			return new(attr), true
		}
	}

	return nil, false
}

// Attributes returns the attributes as a user read holds them.
func (attrs CreateAttributes) Attributes() Attributes {
	out := make(Attributes, 0, len(attrs))
	for _, attr := range attrs {
		out = append(out, Attribute{Key: attr.Key, Value: attr.Value})
	}
	return out
}

func (attrs *CreateAttributes) fromMap(m map[string]any, schema map[string]any, keyPrefix AttributeKey) error {
	for key, value := range m {
		fullKey := keyPrefix.AppendNode(key)

		switch tp := value.(type) {
		case map[string]any:
			props, _ := maputil.GetNested[map[string]any](schema, []string{"properties", key})
			err := attrs.fromMap(tp, props, fullKey)
			if err != nil {
				return err
			}
		default:
			strUnique, _ := maputil.GetNested[string](schema, []string{"properties", key, SchemaAnnotationUnique})
			attr, err := NewCreateAttribute(fullKey, value, UniqueScopeOf(strUnique))
			if err != nil {
				return err
			}
			*attrs = append(*attrs, *attr)
		}
	}
	return nil
}

// InvalidAttributeNames returns the paths, from the request body's attributes
// object, of every attribute whose name is empty or contains ".". Attributes
// are stored under their dot-joined path (see AttributeKey), so such a name
// cannot be told apart from a nested one: {"a.b": 1} and {"a": {"b": 1}} are
// the same key, and "" has no path at all.
func InvalidAttributeNames(attributes map[string]any) []string {
	var invalid []string
	collectInvalidAttributeNames(attributes, "attributes", &invalid)
	return invalid
}

func collectInvalidAttributeNames(m map[string]any, path string, invalid *[]string) {
	for name, value := range m {
		child := path + "." + name
		if name == "" || strings.Contains(name, ".") {
			*invalid = append(*invalid, child)
			continue
		}
		if nested, ok := value.(map[string]any); ok {
			collectInvalidAttributeNames(nested, child, invalid)
		}
	}
}
