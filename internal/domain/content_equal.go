package domain

import "encoding/json"

// FlowDefinitionsEqual reports whether two flow definitions are the same for
// content-reuse decisions (author file vs stored echo). Identity fields are
// excluded: project, revision id, and timestamps.
func FlowDefinitionsEqual(a, b *FlowDefinition) (bool, error) {
	ab, err := json.Marshal(flowDefinitionComparable(a))
	if err != nil {
		return false, err
	}
	bb, err := json.Marshal(flowDefinitionComparable(b))
	if err != nil {
		return false, err
	}
	return JSONEqual(ab, bb)
}

func flowDefinitionComparable(d *FlowDefinition) map[string]any {
	purposes := map[string]string{}
	for purpose, step := range d.Purposes {
		purposes[purpose.String()] = step
	}
	return map[string]any{
		"name":        d.Name,
		"status":      d.Status.String(),
		"user_schema": d.UserSchema,
		"purposes":    purposes,
		"audience":    d.Audience,
		"steps":       d.Steps,
	}
}

// BrandingsEqual reports whether two branding revisions are the same for
// content-reuse decisions.
func BrandingsEqual(a, b *Branding) (bool, error) {
	ab, err := json.Marshal(brandingComparable(a))
	if err != nil {
		return false, err
	}
	bb, err := json.Marshal(brandingComparable(b))
	if err != nil {
		return false, err
	}
	return JSONEqual(ab, bb)
}

func brandingComparable(b *Branding) map[string]any {
	return map[string]any{
		"layout":          b.Layout,
		"liquid_template": b.LiquidTemplate,
		"logo_url":        b.LogoURL,
		"hero_url":        b.HeroURL,
		"theme":           b.Theme,
		"typography":      b.Typography,
		"shape":           b.Shape,
	}
}
