package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// maxReleasePointers is the most a release may pin, matching the OpenAPI cap.
const maxReleasePointers = 50

// BuildSchema is one schemas[] entry: either an inline user-schema document or a schema-url.
type BuildSchema struct {
	Index    int
	Document []byte // inline user-schema JSON; mutually exclusive with URL
	URL      string // schema-url; mutually exclusive with Document
}

// BuildIDP is one idps[] entry.
type BuildIDP struct {
	Index    int
	Document []byte
}

// BuildFlowDefinition is one flow_definitions[] entry with its bundle index.
type BuildFlowDefinition struct {
	Index   int
	Request FlowDefinitionRequest
}

// BuildReleaseInput is the decoded bundle plus metadata for Build.
type BuildReleaseInput struct {
	ProjectID       string
	Schemas         []BuildSchema
	FlowDefinitions []BuildFlowDefinition
	IDPs            []BuildIDP
	Branding        *CreateBrandingInput
	Message         *string
	GitSHA          *string
	GitDirty        bool
}

// Build turns a configuration bundle into a release in one transaction:
// unchanged resources reuse their newest revision, changed ones allocate, and
// the release is created or the existing content-hash match is returned.
func (s *releaseService) Build(ctx context.Context, input BuildReleaseInput) (*CreateReleaseOutput, error) {
	if err := s.validateBundleShape(input); err != nil {
		return nil, err
	}

	failures := &BundleValidationError{}
	preparedSchemas, schemaByHandle, err := s.prepareBundleSchemas(ctx, input, failures)
	if err != nil {
		return nil, err
	}
	preparedFlows, err := s.prepareBundleFlows(ctx, input, schemaByHandle, failures)
	if err != nil {
		return nil, err
	}
	preparedIDPs := s.prepareBundleIDPs(input, failures)
	var preparedBranding *domain.Branding
	if input.Branding != nil {
		preparedBranding, err = prepareBranding(*input.Branding)
		if err != nil {
			failures.add(domain.ReleasePointerKindBranding, 0, domain.ReleaseBrandingHandle, err)
		}
	}
	if len(failures.Resources) > 0 {
		return nil, failures
	}

	var (
		out         *CreateReleaseOutput
		contentHash string
	)
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		content := domain.ReleaseContent{}

		for i, prepared := range preparedSchemas {
			schema, err := s.resolveOrCreateSchema(ctx, stmts, input.ProjectID, input.Schemas[i], prepared)
			if err != nil {
				return err
			}
			content.Schemas = append(content.Schemas, schema)
		}
		for _, flow := range preparedFlows {
			definition, err := s.resolveOrCreateFlow(ctx, stmts, input.ProjectID, flow)
			if err != nil {
				return err
			}
			content.FlowDefinitions = append(content.FlowDefinitions, definition)
		}
		for _, doc := range preparedIDPs {
			connection, err := s.idps.createOrRevise(ctx, stmts, input.ProjectID, doc)
			if err != nil {
				return err
			}
			content.IDPConnections = append(content.IDPConnections, connection.Connection)
		}
		if preparedBranding != nil {
			brandingEntity, err := s.resolveOrCreateBranding(ctx, stmts, input.ProjectID, preparedBranding)
			if err != nil {
				return err
			}
			content.Branding = brandingEntity
		}

		if err := s.autoPinReferences(ctx, stmts, input.ProjectID, &content); err != nil {
			return err
		}
		if len(content.Pointers()) > maxReleasePointers {
			return domain.ErrReleaseInvalid(
				fmt.Sprintf("a release may pin at most %d resources", maxReleasePointers), nil)
		}
		if err := domain.ValidateRelease(content); err != nil {
			return err
		}

		actor, _ := audit.ActorFromContext(ctx)
		entity, err := domain.NewRelease(input.ProjectID, content.Pointers(), domain.ReleaseMetadata{
			Message:       input.Message,
			GitSHA:        input.GitSHA,
			GitDirty:      input.GitDirty,
			CreatedBy:     actor.ActorID,
			CreatedByType: actor.ActorType,
		})
		if err != nil {
			return err
		}
		contentHash = entity.ContentHash

		existing, err := stmts.GetReleaseByContentHash(ctx, input.ProjectID, entity.ContentHash)
		if err == nil {
			out = &CreateReleaseOutput{Release: existing}
			return nil
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
			return domain.ErrInternal(err).WithMessage("failed to look up release by content hash")
		}

		if err := stmts.CreateRelease(ctx, entity); err != nil {
			return err
		}
		if err := audit.Emit(ctx, stmts, audit.EmitSpec{
			Type:       domain.EventTypeReleaseCreated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  entity.ProjectID,
			EntityType: "release",
			EntityID:   entity.ID,
			Payload:    domain.ReleasePayloadSnapshot(entity),
		}); err != nil {
			return err
		}
		out = &CreateReleaseOutput{Release: entity, Created: true}
		return nil
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok && contentHash != "" {
			raced, hashErr := s.getByContentHash(ctx, input.ProjectID, contentHash)
			if hashErr != nil {
				return nil, hashErr
			}
			if raced != nil {
				return &CreateReleaseOutput{Release: raced}, nil
			}
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return nil, domain.ErrReleaseProjectNotFound().WithParent(err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to build release")
	}
	return out, nil
}

func (s *releaseService) validateBundleShape(input BuildReleaseInput) error {
	total := len(input.Schemas) + len(input.FlowDefinitions) + len(input.IDPs)
	if input.Branding != nil {
		total++
	}
	if total == 0 {
		return domain.ErrReleaseInvalid("the bundle is empty", nil)
	}

	seenSchema := map[string]int{}
	for _, schema := range input.Schemas {
		if schema.URL != "" {
			continue
		}
		handle, err := schemaObjectType(schema.Document)
		if err != nil {
			return domain.ErrReleaseInvalid(err.Error(), err)
		}
		if handle == "" {
			return domain.ErrReleaseInvalid("every bundled schema needs an objectType", nil)
		}
		if prev, ok := seenSchema[handle]; ok {
			return domain.ErrReleaseInvalid(
				fmt.Sprintf("schema %q appears twice (indices %d and %d)", handle, prev, schema.Index), nil)
		}
		seenSchema[handle] = schema.Index
		if hasTopLevelID(schema.Document) {
			return domain.ErrReleaseInvalid(
				fmt.Sprintf("schema %q must not declare $id", handle), nil)
		}
	}

	seenFlow := map[string]int{}
	for _, flow := range input.FlowDefinitions {
		name := strings.TrimSpace(flow.Request.Name)
		if name == "" {
			return domain.ErrReleaseInvalid("every bundled flow definition needs a name", nil)
		}
		if prev, ok := seenFlow[name]; ok {
			return domain.ErrReleaseInvalid(
				fmt.Sprintf("flow_definition %q appears twice (indices %d and %d)", name, prev, flow.Index), nil)
		}
		seenFlow[name] = flow.Index
	}

	seenIDP := map[string]int{}
	for _, idp := range input.IDPs {
		slug, err := idpSlug(idp.Document)
		if err != nil {
			return domain.ErrReleaseInvalid(err.Error(), err)
		}
		if slug == "" {
			return domain.ErrReleaseInvalid("every bundled idp needs a slug", nil)
		}
		if prev, ok := seenIDP[slug]; ok {
			return domain.ErrReleaseInvalid(
				fmt.Sprintf("idp %q appears twice (indices %d and %d)", slug, prev, idp.Index), nil)
		}
		seenIDP[slug] = idp.Index
	}
	return nil
}

type preparedSchema struct {
	model *domain.JSONSchema // nil for schema-url until resolved/created
	url   string
}

func (s *releaseService) prepareBundleSchemas(
	ctx context.Context,
	input BuildReleaseInput,
	failures *BundleValidationError,
) ([]preparedSchema, map[string]*domain.JSONSchema, error) {
	prepared := make([]preparedSchema, len(input.Schemas))
	byHandle := make(map[string]*domain.JSONSchema, len(input.Schemas))
	for i, schema := range input.Schemas {
		if schema.URL != "" {
			prepared[i] = preparedSchema{url: schema.URL}
			continue
		}
		model, err := s.schemas.prepareSchema(CreateSchemaInput{
			ProjectID: input.ProjectID,
			Schema:    schema.Document,
		})
		if err != nil {
			handle, _ := schemaObjectType(schema.Document)
			failures.add(domain.ReleasePointerKindSchema, schema.Index, handle, err)
			continue
		}
		prepared[i] = preparedSchema{model: model}
		if model.ObjectType != nil {
			byHandle[*model.ObjectType] = model
		}
	}
	_ = ctx
	return prepared, byHandle, nil
}

func (s *releaseService) prepareBundleFlows(
	ctx context.Context,
	input BuildReleaseInput,
	bundleSchemas map[string]*domain.JSONSchema,
	failures *BundleValidationError,
) ([]*domain.FlowDefinition, error) {
	prepared := make([]*domain.FlowDefinition, 0, len(input.FlowDefinitions))
	stmts := s.v2Pool.Statements()
	for _, flow := range input.FlowDefinitions {
		req := flow.Request
		req.ProjectID = input.ProjectID
		definition, err := s.flows.prepareFlowDefinition(ctx, stmts, req, bundleSchemas)
		if err != nil {
			failures.add(domain.ReleasePointerKindFlowDefinition, flow.Index, req.Name, err)
			continue
		}
		prepared = append(prepared, definition)
	}
	return prepared, nil
}

func (s *releaseService) prepareBundleIDPs(input BuildReleaseInput, failures *BundleValidationError) [][]byte {
	docs := make([][]byte, 0, len(input.IDPs))
	for _, idp := range input.IDPs {
		slug, err := s.idps.validate(idp.Document)
		if err != nil {
			failures.add(domain.ReleasePointerKindIDP, idp.Index, slug, err)
			continue
		}
		docs = append(docs, idp.Document)
	}
	return docs
}

func (s *releaseService) resolveOrCreateSchema(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	entry BuildSchema,
	prepared preparedSchema,
) (*domain.JSONSchema, error) {
	if prepared.url != "" {
		existing, err := stmts.GetJSONSchemaByID(ctx, projectID, prepared.url)
		if err == nil {
			return existing, nil
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
			return nil, domain.ErrInternal(err).WithMessage("failed to look up schema by url")
		}
		if err := s.schemas.createSchemaByURL(ctx, stmts, projectID, prepared.url); err != nil {
			return nil, err
		}
		return stmts.GetJSONSchemaByID(ctx, projectID, prepared.url)
	}

	handle := ""
	if prepared.model.ObjectType != nil {
		handle = *prepared.model.ObjectType
	}
	latest, err := latestSchemaByObjectType(ctx, stmts, projectID, handle)
	if err != nil {
		return nil, err
	}
	if latest != nil {
		same, eqErr := domain.JSONEqual(entry.Document, latest.Schema, "$id")
		if eqErr == nil && same {
			return latest, nil
		}
	}
	if err := s.schemas.createSchema(ctx, stmts, prepared.model); err != nil {
		return nil, err
	}
	return prepared.model, nil
}

func (s *releaseService) resolveOrCreateFlow(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	definition *domain.FlowDefinition,
) (*domain.FlowDefinition, error) {
	latest, err := latestFlowByName(ctx, stmts, projectID, definition.Name)
	if err != nil {
		return nil, err
	}
	if latest != nil {
		same, eqErr := flowDefinitionsEqual(definition, latest)
		if eqErr == nil && same {
			return latest, nil
		}
	}
	if err := s.flows.createFlowDefinition(ctx, stmts, definition); err != nil {
		return nil, err
	}
	return definition, nil
}

func (s *releaseService) resolveOrCreateBranding(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	prepared *domain.Branding,
) (*domain.Branding, error) {
	latest, err := latestBranding(ctx, stmts, projectID)
	if err != nil {
		return nil, err
	}
	if latest != nil {
		same, eqErr := brandingEqual(prepared, latest)
		if eqErr == nil && same {
			return latest, nil
		}
	}
	if err := s.branding.createBranding(ctx, stmts, prepared); err != nil {
		return nil, err
	}
	return prepared, nil
}

// autoPinReferences adds project revisions for handles named by the bundle
// but not carried in it. A handle neither holds is left for ValidateRelease.
func (s *releaseService) autoPinReferences(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	content *domain.ReleaseContent,
) error {
	type key struct {
		kind   domain.ReleasePointerKind
		handle string
	}
	included := map[key]bool{}
	for _, pointer := range content.Pointers() {
		included[key{pointer.Kind, pointer.Handle}] = true
	}

	needSchema := map[string]struct{}{}
	needIDP := map[string]struct{}{}
	for _, flow := range content.FlowDefinitions {
		if !included[key{domain.ReleasePointerKindSchema, flow.UserSchema}] {
			needSchema[flow.UserSchema] = struct{}{}
		}
		for _, step := range flow.Steps {
			for _, slug := range step.SSOProviders {
				if !included[key{domain.ReleasePointerKindIDP, slug}] {
					needIDP[slug] = struct{}{}
				}
			}
		}
	}
	for _, schema := range content.Schemas {
		doc, err := schema.Document()
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to unmarshal user schema")
		}
		slugs, err := domain.SchemaSSOProviderSlugs(doc)
		if err != nil {
			return err
		}
		for _, slug := range slugs {
			if !included[key{domain.ReleasePointerKindIDP, slug}] {
				needIDP[slug] = struct{}{}
			}
		}
	}

	for handle := range needSchema {
		latest, err := latestSchemaByObjectType(ctx, stmts, projectID, handle)
		if err != nil {
			return err
		}
		if latest != nil {
			content.Schemas = append(content.Schemas, latest)
			included[key{domain.ReleasePointerKindSchema, handle}] = true
		}
	}
	for slug := range needIDP {
		connection, err := stmts.GetIDPConnection(ctx, idpConnectionBy(projectID, domain.IDPConnectionFieldSlug, slug))
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			return domain.ErrInternal(err).WithMessage("failed to look up identity provider connection")
		}
		content.IDPConnections = append(content.IDPConnections, connection)
		included[key{domain.ReleasePointerKindIDP, slug}] = true
	}
	return nil
}

func latestSchemaByObjectType(ctx context.Context, stmts AllStatements, projectID, objectType string) (*domain.JSONSchema, error) {
	if objectType == "" {
		return nil, nil
	}
	result, err := stmts.ListJSONSchemas(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(
			database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
			database.Equal(database.Col(domain.JSONSchemaFieldObjectType), objectType),
		),
		Pagination: database.Page[domain.JSONSchemaField]{Limit: 1},
	}, JSONSchemaQueryOptions{LatestRevisionPerObjectType: true})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list schemas")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

func latestFlowByName(ctx context.Context, stmts AllStatements, projectID, name string) (*domain.FlowDefinition, error) {
	result, err := stmts.ListFlowDefinitions(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
			database.Equal(database.Col(domain.FlowDefinitionFieldName), name),
		),
		Pagination: database.Page[domain.FlowDefinitionField]{Limit: 1},
	}, FlowDefinitionQueryOptions{LatestRevisionPerName: true})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list flow definitions")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

func latestBranding(ctx context.Context, stmts AllStatements, projectID string) (*domain.Branding, error) {
	result, err := stmts.ListBrandings(WithAuthzListUnrestricted(ctx), branding.ListOptions(projectID, 1))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list branding")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

func schemaObjectType(document []byte) (string, error) {
	var doc struct {
		ObjectType string `json:"objectType"`
	}
	if err := json.Unmarshal(document, &doc); err != nil {
		return "", err
	}
	return strings.TrimSpace(doc.ObjectType), nil
}

func hasTopLevelID(document []byte) bool {
	var doc map[string]any
	if err := json.Unmarshal(document, &doc); err != nil {
		return false
	}
	_, ok := doc["$id"]
	return ok
}

func idpSlug(document []byte) (string, error) {
	var doc struct {
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal(document, &doc); err != nil {
		return "", err
	}
	return strings.TrimSpace(doc.Slug), nil
}

func flowDefinitionsEqual(a, b *domain.FlowDefinition) (bool, error) {
	ab, err := json.Marshal(flowDefinitionComparable(a))
	if err != nil {
		return false, err
	}
	bb, err := json.Marshal(flowDefinitionComparable(b))
	if err != nil {
		return false, err
	}
	return domain.JSONEqual(ab, bb)
}

func flowDefinitionComparable(d *domain.FlowDefinition) map[string]any {
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

func brandingEqual(a, b *domain.Branding) (bool, error) {
	ab, err := json.Marshal(brandingComparable(a))
	if err != nil {
		return false, err
	}
	bb, err := json.Marshal(brandingComparable(b))
	if err != nil {
		return false, err
	}
	return domain.JSONEqual(ab, bb)
}

func brandingComparable(b *domain.Branding) map[string]any {
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

// ParseSchemaURL validates a schema-url string for Build.
func ParseSchemaURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() {
		return "", domain.ErrReleaseInvalid(fmt.Sprintf("schema-url %q is not an absolute URL", raw), err)
	}
	return u.String(), nil
}
