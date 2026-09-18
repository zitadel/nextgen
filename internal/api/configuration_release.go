package api

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// CreateConfigurationRelease is the bundle constructor (ADR 035, #545): the
// CLI posts the contents of `.zitadel/` and gets a release back.
//
// Per resource the bundled content is compared against the project's newest
// revision of the same handle; a match reuses it, anything else allocates a
// new revision through the per-kind service. Flow definitions reference
// their schema by handle (objectType), resolved against the schemas this
// same bundle produced. The set of revisions is then assembled into a
// release exactly as POST /releases would.
//
// Prototype: the per-kind writes and the release are separate transactions.
func (h *Handler) CreateConfigurationRelease(ctx context.Context, req *api.ConfigurationBundle, params api.CreateConfigurationReleaseParams) (api.CreateConfigurationReleaseRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, releaseAccess, opWrite); err != nil {
		return nil, err
	}
	if len(req.Schemas)+len(req.FlowDefinitions)+len(req.Brandings) == 0 {
		return nil, domain.ErrReleaseInvalid("the bundle is empty", nil)
	}

	var (
		pointers  []service.CreateReleasePointer
		revisions []api.ConfigurationReleaseResponseRevisionsItem
	)
	record := func(kind domain.ReleasePointerKind, handle, revisionID string, created bool) {
		pointers = append(pointers, service.CreateReleasePointer{Kind: kind, RevisionID: revisionID})
		revisions = append(revisions, api.ConfigurationReleaseResponseRevisionsItem{
			Kind:       api.ReleasePointerKind(kind.String()),
			Handle:     handle,
			RevisionID: revisionID,
			Created:    created,
		})
	}

	// Schemas first: flows reference them by handle.
	schemaIDByHandle := make(map[string]string, len(req.Schemas))
	for i := range req.Schemas {
		schema := &req.Schemas[i]
		handle, ok := schema.ObjectType.Get()
		if !ok || strings.TrimSpace(handle) == "" {
			return nil, domain.ErrReleaseInvalid("every bundled schema needs an objectType", nil)
		}
		revisionID, created, err := h.bundleSchema(ctx, projectID, handle, schema)
		if err != nil {
			return nil, err
		}
		schemaIDByHandle[handle] = revisionID
		record(domain.ReleasePointerKindSchema, handle, revisionID, created)
	}

	for i := range req.FlowDefinitions {
		definition := req.FlowDefinitions[i]
		if strings.TrimSpace(definition.Name) == "" {
			return nil, domain.ErrReleaseInvalid("every bundled flow definition needs a name", nil)
		}
		schemaID, err := h.resolveSchemaHandle(ctx, projectID, definition.UserSchema, schemaIDByHandle)
		if err != nil {
			return nil, err
		}
		definition.UserSchema = schemaID
		revisionID, created, err := h.bundleFlowDefinition(ctx, projectID, req.FlowSchemaURI, definition)
		if err != nil {
			return nil, err
		}
		record(domain.ReleasePointerKindFlowDefinition, definition.Name, revisionID, created)
	}

	for i := range req.Brandings {
		revisionID, created, err := h.bundleBranding(ctx, projectID, req.Brandings[i])
		if err != nil {
			return nil, err
		}
		record(domain.ReleasePointerKindBranding, domain.ReleaseBrandingHandle, revisionID, created)
	}

	input := service.CreateReleaseInput{
		ProjectID: projectID,
		Pointers:  pointers,
		GitDirty:  req.GitDirty.Or(false),
	}
	if message, ok := req.Message.Get(); ok {
		input.Message = &message
	}
	if gitSHA, ok := req.GitSha.Get(); ok {
		input.GitSHA = &gitSHA
	}
	result, err := h.releaseService.Create(ctx, input)
	if err != nil {
		return nil, err
	}

	resp := api.ConfigurationReleaseResponse{
		Release:   toAPIRelease(result.Release),
		Revisions: revisions,
	}
	if result.Created {
		created := api.CreateConfigurationReleaseCreated(resp)
		return &created, nil
	}
	reused := api.CreateConfigurationReleaseOK(resp)
	return &reused, nil
}

// bundleSchema reuses the newest revision of the object type when the
// bundled document matches it, otherwise creates a new revision.
func (h *Handler) bundleSchema(ctx context.Context, projectID, handle string, schema *api.UserSchema) (string, bool, error) {
	wire, err := schema.MarshalJSON()
	if err != nil {
		return "", false, domain.ErrReleaseInvalid("schema is not serialisable", err)
	}
	listed, err := h.schemaService.ListSchemas(ctx, service.ListSchemasInput{
		ProjectID:                   projectID,
		ObjectType:                  handle,
		LatestRevisionPerObjectType: true,
		Limit:                       1,
	})
	if err != nil {
		return "", false, err
	}
	if len(listed.Items) > 0 {
		current := listed.Items[0]
		if same, err := sameJSON(wire, current.Schema, "$id"); err == nil && same {
			return current.URL, false, nil
		}
	}
	created, err := h.schemaService.CreateSchema(ctx, service.CreateSchemaInput{ProjectID: projectID, Schema: wire})
	if err != nil {
		return "", false, err
	}
	return created.URL, true, nil
}

// resolveSchemaHandle turns a flow's user_schema handle into a schema id:
// the schema this bundle produced under that objectType, else the project's
// newest revision of it, else the value as given (already an id or URL).
func (h *Handler) resolveSchemaHandle(ctx context.Context, projectID, handle string, fromBundle map[string]string) (string, error) {
	if id, ok := fromBundle[handle]; ok {
		return id, nil
	}
	listed, err := h.schemaService.ListSchemas(ctx, service.ListSchemasInput{
		ProjectID:                   projectID,
		ObjectType:                  handle,
		LatestRevisionPerObjectType: true,
		Limit:                       1,
	})
	if err != nil {
		return "", err
	}
	if len(listed.Items) > 0 {
		return listed.Items[0].URL, nil
	}
	return handle, nil
}

// bundleFlowDefinition reuses the newest revision of the name when the
// bundled definition matches it, otherwise creates a new revision.
func (h *Handler) bundleFlowDefinition(ctx context.Context, projectID string, flowSchemaURI api.OptSchemaURI, definition api.FlowDefinition) (string, bool, error) {
	listed, err := h.flowDefinitionService.List(ctx, service.ListFlowDefinitionsRequest{
		ProjectID:             projectID,
		Name:                  definition.Name,
		LatestRevisionPerName: true,
		Limit:                 1,
	})
	if err != nil {
		return "", false, err
	}
	if len(listed.Items) > 0 {
		current := flowDefinitionResponse(listed.Items[0]).FlowDefinition
		if same, err := sameAPIValue(&definition, &current, "$schema"); err == nil && same {
			return listed.Items[0].ID, false, nil
		}
	}
	svcReq, err := mapCreateRequestToService(&api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(projectID),
		SchemaURI:      flowSchemaURI,
		FlowDefinition: definition,
	})
	if err != nil {
		return "", false, err
	}
	created, err := h.flowDefinitionService.Create(ctx, svcReq)
	if err != nil {
		return "", false, err
	}
	return created.ID, true, nil
}

// bundleBranding reuses the newest branding revision when the bundled
// descriptor matches it, otherwise publishes a new revision.
func (h *Handler) bundleBranding(ctx context.Context, projectID string, branding api.Branding) (string, bool, error) {
	current, err := h.brandingService.GetLatest(ctx, projectID)
	if err != nil {
		return "", false, err
	}
	if current != nil {
		existing := toAPIBranding(current)
		if same, err := sameAPIValue(&branding, &existing); err == nil && same {
			return current.ID, false, nil
		}
	}
	created, err := h.brandingService.Create(ctx, service.CreateBrandingInput{
		ProjectID:      projectID,
		Layout:         string(branding.Layout.Value),
		LiquidTemplate: branding.LiquidTemplate.Value,
		LogoURL:        optURIString(branding.LogoURL),
		HeroURL:        optURIString(branding.HeroURL),
		Theme:          brandingThemeFromAPI(branding.Theme),
		Typography:     brandingTypographyFromAPI(branding.Typography),
		Shape:          brandingShapeFromAPI(branding.Shape),
	})
	if err != nil {
		return "", false, err
	}
	return created.ID, true, nil
}

// sameAPIValue compares two generated wire values by their canonical JSON,
// ignoring the named top-level keys.
func sameAPIValue(a, b json.Marshaler, ignore ...string) (bool, error) {
	ab, err := a.MarshalJSON()
	if err != nil {
		return false, err
	}
	bb, err := b.MarshalJSON()
	if err != nil {
		return false, err
	}
	return sameJSON(ab, bb, ignore...)
}

// sameJSON reports whether two JSON documents are structurally equal after
// dropping the named top-level keys. Key order and whitespace do not count.
func sameJSON(a, b []byte, ignore ...string) (bool, error) {
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		return false, err
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		return false, err
	}
	for _, key := range ignore {
		if m, ok := av.(map[string]any); ok {
			delete(m, key)
		}
		if m, ok := bv.(map[string]any); ok {
			delete(m, key)
		}
	}
	return reflect.DeepEqual(av, bv), nil
}
