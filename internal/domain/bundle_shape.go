package domain

import (
	"encoding/json"
	"fmt"
	"strings"
)

// BundleShapeSchema is one schemas[] entry for shape validation.
type BundleShapeSchema struct {
	Index    int
	Document []byte // empty when the entry is a schema URL
	URL      string
}

// BundleShapeFlow is one flow_definitions[] entry for shape validation.
type BundleShapeFlow struct {
	Index int
	Name  string
}

// BundleShapeIDP is one idps[] entry for shape validation.
type BundleShapeIDP struct {
	Index    int
	Document []byte
}

// BundleShapePolicy is one policies[] entry for shape validation.
type BundleShapePolicy struct {
	Index     int
	Operation string
}

// BundleShapeInput is the author-facing bundle shape ValidateBundleShape checks.
type BundleShapeInput struct {
	Schemas     []BundleShapeSchema
	Flows       []BundleShapeFlow
	IDPs        []BundleShapeIDP
	Policies    []BundleShapePolicy
	HasBranding bool
}

// BundleShapeFailure is one shape rule that a bundle entry broke.
type BundleShapeFailure struct {
	Kind   ReleasePointerKind
	Index  int
	Handle string
	Err    Error
}

// ValidateBundleShape checks authoring rules that do not need storage: empty
// handles, duplicate handles, and schema documents that declare $id. Every
// failure is returned so Build can report them together. An empty bundle is
// not a resource failure — callers refuse it with ErrReleaseInvalid.
func ValidateBundleShape(input BundleShapeInput) []BundleShapeFailure {
	total := len(input.Schemas) + len(input.Flows) + len(input.IDPs) + len(input.Policies)
	if input.HasBranding {
		total++
	}
	if total == 0 {
		return nil
	}

	var failures []BundleShapeFailure

	seenSchema := map[string]int{}
	for _, schema := range input.Schemas {
		if schema.URL != "" {
			continue
		}
		handle, err := SchemaDocumentObjectType(schema.Document)
		if err != nil {
			failures = append(failures, BundleShapeFailure{
				Kind:  ReleasePointerKindSchema,
				Index: schema.Index,
				Err:   ErrReleaseInvalid(err.Error(), err),
			})
			continue
		}
		if handle == "" {
			failures = append(failures, BundleShapeFailure{
				Kind:  ReleasePointerKindSchema,
				Index: schema.Index,
				Err:   ErrReleaseInvalid("every bundled schema needs an objectType", nil),
			})
			continue
		}
		if prev, ok := seenSchema[handle]; ok {
			msg := fmt.Sprintf("schema %q appears twice (indices %d and %d)", handle, prev, schema.Index)
			// Both entries are refused so prepare skips them rather than
			// validating one half of a duplicate pair.
			failures = append(failures,
				BundleShapeFailure{Kind: ReleasePointerKindSchema, Index: prev, Handle: handle, Err: ErrReleaseInvalid(msg, nil)},
				BundleShapeFailure{Kind: ReleasePointerKindSchema, Index: schema.Index, Handle: handle, Err: ErrReleaseInvalid(msg, nil)},
			)
			continue
		}
		seenSchema[handle] = schema.Index
		if SchemaDocumentHasTopLevelID(schema.Document) {
			failures = append(failures, BundleShapeFailure{
				Kind:   ReleasePointerKindSchema,
				Index:  schema.Index,
				Handle: handle,
				Err:    ErrReleaseInvalid(fmt.Sprintf("schema %q must not declare $id", handle), nil),
			})
		}
	}

	seenFlow := map[string]int{}
	for _, flow := range input.Flows {
		name := strings.TrimSpace(flow.Name)
		if name == "" {
			failures = append(failures, BundleShapeFailure{
				Kind:  ReleasePointerKindFlowDefinition,
				Index: flow.Index,
				Err:   ErrReleaseInvalid("every bundled flow definition needs a name", nil),
			})
			continue
		}
		if prev, ok := seenFlow[name]; ok {
			msg := fmt.Sprintf("flow_definition %q appears twice (indices %d and %d)", name, prev, flow.Index)
			failures = append(failures,
				BundleShapeFailure{Kind: ReleasePointerKindFlowDefinition, Index: prev, Handle: name, Err: ErrReleaseInvalid(msg, nil)},
				BundleShapeFailure{Kind: ReleasePointerKindFlowDefinition, Index: flow.Index, Handle: name, Err: ErrReleaseInvalid(msg, nil)},
			)
			continue
		}
		seenFlow[name] = flow.Index
	}

	seenIDP := map[string]int{}
	for _, idp := range input.IDPs {
		slug, err := IDPDocumentSlug(idp.Document)
		if err != nil {
			failures = append(failures, BundleShapeFailure{
				Kind:  ReleasePointerKindIDP,
				Index: idp.Index,
				Err:   ErrReleaseInvalid(err.Error(), err),
			})
			continue
		}
		if slug == "" {
			failures = append(failures, BundleShapeFailure{
				Kind:  ReleasePointerKindIDP,
				Index: idp.Index,
				Err:   ErrReleaseInvalid("every bundled idp needs a slug", nil),
			})
			continue
		}
		if prev, ok := seenIDP[slug]; ok {
			msg := fmt.Sprintf("idp %q appears twice (indices %d and %d)", slug, prev, idp.Index)
			failures = append(failures,
				BundleShapeFailure{Kind: ReleasePointerKindIDP, Index: prev, Handle: slug, Err: ErrReleaseInvalid(msg, nil)},
				BundleShapeFailure{Kind: ReleasePointerKindIDP, Index: idp.Index, Handle: slug, Err: ErrReleaseInvalid(msg, nil)},
			)
			continue
		}
		seenIDP[slug] = idp.Index
	}

	// The operation is the policy's handle: a project has one policy per
	// operation, so a release cannot pin two. The decoder already holds it to
	// a catalogued operation.
	seenPolicy := map[string]int{}
	for _, policy := range input.Policies {
		if prev, ok := seenPolicy[policy.Operation]; ok {
			msg := fmt.Sprintf("policy %q appears twice (indices %d and %d)", policy.Operation, prev, policy.Index)
			failures = append(failures,
				BundleShapeFailure{Kind: ReleasePointerKindPolicy, Index: prev, Handle: policy.Operation, Err: ErrReleaseInvalid(msg, nil)},
				BundleShapeFailure{Kind: ReleasePointerKindPolicy, Index: policy.Index, Handle: policy.Operation, Err: ErrReleaseInvalid(msg, nil)},
			)
			continue
		}
		seenPolicy[policy.Operation] = policy.Index
	}

	return failures
}

// SchemaDocumentObjectType returns the objectType of an inline schema document.
func SchemaDocumentObjectType(document []byte) (string, error) {
	var doc struct {
		ObjectType string `json:"objectType"`
	}
	if err := json.Unmarshal(document, &doc); err != nil {
		return "", err
	}
	return strings.TrimSpace(doc.ObjectType), nil
}

// SchemaDocumentHasTopLevelID reports whether document declares a top-level $id.
func SchemaDocumentHasTopLevelID(document []byte) bool {
	var doc map[string]any
	if err := json.Unmarshal(document, &doc); err != nil {
		return false
	}
	_, ok := doc["$id"]
	return ok
}

// IDPDocumentSlug returns the slug of an identity-provider connection document.
func IDPDocumentSlug(document []byte) (string, error) {
	var doc struct {
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal(document, &doc); err != nil {
		return "", err
	}
	return strings.TrimSpace(doc.Slug), nil
}

// BundleEmpty reports whether the bundle carries no resources.
func BundleEmpty(input BundleShapeInput) bool {
	return len(input.Schemas)+len(input.Flows)+len(input.IDPs)+len(input.Policies) == 0 && !input.HasBranding
}
