package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// maxReleasePointers is the most a release may pin, matching the OpenAPI cap.
const maxReleasePointers = 50

// BuildSchema is one schemas[] entry: either an inline user-schema document or a schema-url.
type BuildSchema struct {
	Index    int
	Document []byte
	URL      string
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

type preparedIDP struct {
	slug     string
	document []byte
}

type preparedSchema struct {
	model *domain.JSONSchema // nil for schema-url until resolved/created
	url   string
}

// Build turns a configuration bundle into a release in one transaction:
// unchanged resources reuse their newest revision, changed ones allocate, and
// the release is created or the existing content-hash match is returned.
func (s *releaseService) Build(ctx context.Context, input BuildReleaseInput) (*CreateReleaseOutput, error) {
	if err := s.validateBundleShape(input); err != nil {
		return nil, err
	}

	failures := &BundleValidationError{}
	preparedSchemas, schemaByHandle := s.prepareBundleSchemas(input, failures)
	preparedIDPs := s.prepareBundleIDPs(input, failures)
	var preparedBranding *domain.Branding
	if input.Branding != nil {
		var err error
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
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()

		// Prepare flows on the build transaction so schema/pivoting lookups
		// share the same stmts as the writes that follow. Collect failures
		// before any write so a BundleValidationError rolls back cleanly.
		flowFailures := &BundleValidationError{}
		preparedFlows := s.prepareBundleFlows(ctx, stmts, input, schemaByHandle, flowFailures)
		if len(flowFailures.Resources) > 0 {
			return flowFailures
		}

		content := domain.ReleaseContent{}
		for i, prepared := range preparedSchemas {
			schema, err := s.schemas.resolveOrCreateSchema(
				ctx, stmts, input.ProjectID,
				input.Schemas[i].Document, prepared.model, prepared.url,
			)
			if err != nil {
				return err
			}
			content.Schemas = append(content.Schemas, schema)
		}
		for _, flow := range preparedFlows {
			definition, err := s.flows.resolveOrCreateFlow(ctx, stmts, input.ProjectID, flow)
			if err != nil {
				return err
			}
			content.FlowDefinitions = append(content.FlowDefinitions, definition)
		}
		for _, idp := range preparedIDPs {
			connection, err := s.idps.resolveOrCreate(ctx, stmts, input.ProjectID, idp.slug, idp.document)
			if err != nil {
				return err
			}
			content.IDPConnections = append(content.IDPConnections, connection.Connection)
		}
		if preparedBranding != nil {
			brandingEntity, err := s.branding.resolveOrCreateBranding(ctx, stmts, input.ProjectID, preparedBranding)
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

		entity, err := s.newReleaseEntity(ctx, input.ProjectID, content, domain.ReleaseMetadata{
			Message:  input.Message,
			GitSHA:   input.GitSHA,
			GitDirty: input.GitDirty,
		})
		if err != nil {
			return err
		}
		contentHash = entity.ContentHash
		out, err = finalizeReleaseOn(ctx, stmts, entity)
		return err
	})
	if err != nil {
		if bundleErr, ok := errors.AsType[*BundleValidationError](err); ok {
			return nil, bundleErr
		}
		if recovered, mapped, mapErr := s.mapReleasePersistError(ctx, input.ProjectID, contentHash, err); mapErr != nil {
			return nil, mapErr
		} else if mapped {
			return recovered, nil
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
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

func (s *releaseService) prepareBundleSchemas(
	input BuildReleaseInput,
	failures *BundleValidationError,
) ([]preparedSchema, map[string]*domain.JSONSchema) {
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
	return prepared, byHandle
}

func (s *releaseService) prepareBundleFlows(
	ctx context.Context,
	stmts AllStatements,
	input BuildReleaseInput,
	bundleSchemas map[string]*domain.JSONSchema,
	failures *BundleValidationError,
) []*domain.FlowDefinition {
	prepared := make([]*domain.FlowDefinition, 0, len(input.FlowDefinitions))
	for _, flow := range input.FlowDefinitions {
		req := flow.Request
		req.ProjectID = input.ProjectID
		userSchema, err := resolveBundleOrProjectSchema(ctx, stmts, input.ProjectID, req.UserSchema, bundleSchemas)
		if err != nil {
			if errors.Is(err, domain.ErrJSONSchemaNotFound()) {
				err = domain.ErrFlowDefinitionInvalid(fmt.Sprintf("user schema %q not found", req.UserSchema), err)
			} else if _, ok := errors.AsType[domain.Error](err); !ok {
				err = domain.ErrSchemaFetchFailed("failed to fetch user schema", err)
			}
			failures.add(domain.ReleasePointerKindFlowDefinition, flow.Index, req.Name, err)
			continue
		}
		definition, err := s.flows.prepareFlowDefinition(ctx, stmts, req, userSchema)
		if err != nil {
			failures.add(domain.ReleasePointerKindFlowDefinition, flow.Index, req.Name, err)
			continue
		}
		prepared = append(prepared, definition)
	}
	return prepared
}

func resolveBundleOrProjectSchema(
	ctx context.Context,
	stmts AllStatements,
	projectID, handle string,
	bundleSchemas map[string]*domain.JSONSchema,
) (*domain.JSONSchema, error) {
	if schema, ok := bundleSchemas[handle]; ok {
		return schema, nil
	}
	return resolveUserSchema(ctx, stmts, projectID, handle)
}

func (s *releaseService) prepareBundleIDPs(input BuildReleaseInput, failures *BundleValidationError) []preparedIDP {
	docs := make([]preparedIDP, 0, len(input.IDPs))
	for _, idp := range input.IDPs {
		slug, err := s.idps.validate(idp.Document)
		if err != nil {
			failures.add(domain.ReleasePointerKindIDP, idp.Index, slug, err)
			continue
		}
		docs = append(docs, preparedIDP{slug: slug, document: idp.Document})
	}
	return docs
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
