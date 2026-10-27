package service

import (
	"context"
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

// BuildPolicy is one policies[] entry: the operation and the config its
// template validates.
type BuildPolicy struct {
	Index     int
	Operation string
	Config    map[string]any
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
	Policies        []BuildPolicy
	Branding        *CreateBrandingInput
	Message         *string
	GitSHA          *string
	GitDirty        bool
}

type preparedIDP struct {
	index    int
	slug     string
	document []byte
}

type preparedPolicy struct {
	operation string
	config    []byte
}

type preparedSchema struct {
	model *domain.JSONSchema // set for inline after prepare; for URL after in-tx resolve
	url   string
	index int
}

// Build turns a configuration bundle into a release in one transaction:
// unchanged resources reuse a matching revision (any age; for policies only
// the newest, see resolveOrPublish), changed ones allocate, and the release is
// created or the existing content-hash match is returned.
func (s *releaseService) Build(ctx context.Context, input BuildReleaseInput) (_ *CreateReleaseOutput, err error) {
	ctx, end := startSpan(ctx, "ReleaseService.Build")
	defer end(&err)

	shapeInput := bundleShapeInput(input)
	if domain.BundleEmpty(shapeInput) {
		return nil, domain.ErrReleaseInvalid("the bundle is empty", nil)
	}

	failures := &BundleValidationError{}
	for _, failure := range domain.ValidateBundleShape(shapeInput) {
		failures.add(failure.Kind, failure.Index, failure.Handle, failure.Err)
	}

	preparedSchemas, schemaByHandle := s.prepareBundleSchemas(input, failures)
	preparedIDPs := s.prepareBundleIDPs(input, failures)
	preparedPolicies, err := s.prepareBundlePolicies(ctx, input, failures)
	if err != nil {
		return nil, err
	}
	var preparedBranding *domain.Branding
	if input.Branding != nil {
		var err error
		preparedBranding, err = prepareBranding(*input.Branding)
		if err != nil {
			failures.add(domain.ReleasePointerKindBranding, 0, domain.ReleaseBrandingHandle, err)
		}
	}
	// In-tx checks (flows, schema-URL resolve, IDP immutables) can still add
	// to the bag. When nothing in-tx can run, surface pure-prepare failures
	// without opening a transaction.
	needsInTxChecks := len(input.FlowDefinitions) > 0 || hasSchemaURL(input.Schemas) || len(preparedIDPs) > 0
	if !needsInTxChecks && len(failures.Resources) > 0 {
		return nil, failures
	}

	var (
		out         *CreateReleaseOutput
		contentHash string
	)
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()

		// Resolve schema-URL entries before flows so their objectTypes enter
		// schemaByHandle and Pointers() cannot panic on a nil ObjectType.
		if err := s.resolveBundleSchemaURLs(ctx, stmts, input.ProjectID, preparedSchemas, schemaByHandle, failures); err != nil {
			return err
		}

		preparedFlows, err := s.prepareBundleFlows(ctx, stmts, input, schemaByHandle, failures)
		if err != nil {
			return err
		}
		if err := s.checkBundleIDPImmutables(ctx, stmts, input.ProjectID, preparedIDPs, failures); err != nil {
			return err
		}
		if len(failures.Resources) > 0 {
			return failures
		}

		content := domain.ReleaseContent{}
		for i, prepared := range preparedSchemas {
			var schema *domain.JSONSchema
			var err error
			if prepared.url != "" {
				// Already resolved into prepared.model above.
				schema = prepared.model
			} else {
				schema, err = s.schemas.resolveOrCreateSchema(
					ctx, stmts, input.ProjectID,
					input.Schemas[i].Document, prepared.model, "",
				)
			}
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
		for _, prepared := range preparedPolicies {
			revision, err := s.policies.resolveOrPublish(ctx, stmts, input.ProjectID, prepared.operation, prepared.config)
			if err != nil {
				return err
			}
			content.Policies = append(content.Policies, revision)
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
		pointers, err := content.Pointers()
		if err != nil {
			return err
		}
		if len(pointers) > maxReleasePointers {
			capErr := &BundleValidationError{}
			capErr.add(domain.ReleasePointerKindSchema, 0, "",
				domain.ErrReleaseInvalid(fmt.Sprintf("a release may pin at most %d resources", maxReleasePointers), nil))
			return capErr
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

func bundleShapeInput(input BuildReleaseInput) domain.BundleShapeInput {
	schemas := make([]domain.BundleShapeSchema, len(input.Schemas))
	for i, schema := range input.Schemas {
		schemas[i] = domain.BundleShapeSchema{Index: schema.Index, Document: schema.Document, URL: schema.URL}
	}
	flows := make([]domain.BundleShapeFlow, len(input.FlowDefinitions))
	for i, flow := range input.FlowDefinitions {
		flows[i] = domain.BundleShapeFlow{Index: flow.Index, Name: flow.Request.Name}
	}
	idps := make([]domain.BundleShapeIDP, len(input.IDPs))
	for i, idp := range input.IDPs {
		idps[i] = domain.BundleShapeIDP{Index: idp.Index, Document: idp.Document}
	}
	policies := make([]domain.BundleShapePolicy, len(input.Policies))
	for i, policy := range input.Policies {
		policies[i] = domain.BundleShapePolicy{Index: policy.Index, Operation: policy.Operation}
	}
	return domain.BundleShapeInput{
		Schemas:     schemas,
		Flows:       flows,
		IDPs:        idps,
		Policies:    policies,
		HasBranding: input.Branding != nil,
	}
}

func hasSchemaURL(schemas []BuildSchema) bool {
	for _, schema := range schemas {
		if schema.URL != "" {
			return true
		}
	}
	return false
}

func shapeFailed(failures *BundleValidationError, kind domain.ReleasePointerKind, index int) bool {
	for _, r := range failures.Resources {
		if r.Kind == kind && r.Index == index {
			return true
		}
	}
	return false
}

func (s *releaseService) prepareBundleSchemas(
	input BuildReleaseInput,
	failures *BundleValidationError,
) ([]preparedSchema, map[string]*domain.JSONSchema) {
	prepared := make([]preparedSchema, len(input.Schemas))
	byHandle := make(map[string]*domain.JSONSchema, len(input.Schemas))
	for i, schema := range input.Schemas {
		prepared[i].index = schema.Index
		if schema.URL != "" {
			prepared[i].url = schema.URL
			continue
		}
		if shapeFailed(failures, domain.ReleasePointerKindSchema, schema.Index) {
			continue
		}
		model, err := s.schemas.prepareSchema(CreateSchemaInput{
			ProjectID: input.ProjectID,
			Schema:    schema.Document,
		})
		if err != nil {
			handle, _ := domain.SchemaDocumentObjectType(schema.Document)
			failures.add(domain.ReleasePointerKindSchema, schema.Index, handle, err)
			continue
		}
		prepared[i].model = model
		if model.ObjectType != nil {
			byHandle[*model.ObjectType] = model
		}
	}
	return prepared, byHandle
}

// resolveBundleSchemaURLs fetches or reuses each schema-URL entry on stmts and
// registers its objectType in schemaByHandle for flow prepare.
func (s *releaseService) resolveBundleSchemaURLs(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	prepared []preparedSchema,
	schemaByHandle map[string]*domain.JSONSchema,
	failures *BundleValidationError,
) error {
	for i := range prepared {
		if prepared[i].url == "" {
			continue
		}
		if shapeFailed(failures, domain.ReleasePointerKindSchema, prepared[i].index) {
			continue
		}
		schema, err := s.schemas.resolveOrCreateSchemaURL(ctx, stmts, projectID, prepared[i].url)
		if err != nil {
			if isBundleResourceFailure(err) {
				failures.add(domain.ReleasePointerKindSchema, prepared[i].index, "", err)
				continue
			}
			return err
		}
		if schema.ObjectType == nil || *schema.ObjectType == "" {
			failures.add(domain.ReleasePointerKindSchema, prepared[i].index, "",
				domain.ErrReleaseRevisionUnpinnable(fmt.Sprintf("schema url %q declares no objectType", prepared[i].url)))
			continue
		}
		prepared[i].model = schema
		schemaByHandle[*schema.ObjectType] = schema
	}
	return nil
}

func (s *releaseService) prepareBundleFlows(
	ctx context.Context,
	stmts AllStatements,
	input BuildReleaseInput,
	bundleSchemas map[string]*domain.JSONSchema,
	failures *BundleValidationError,
) ([]*domain.FlowDefinition, error) {
	bundleFlows := activeBundleFlowNames(input.FlowDefinitions)
	prepared := make([]*domain.FlowDefinition, 0, len(input.FlowDefinitions))
	for _, flow := range input.FlowDefinitions {
		if shapeFailed(failures, domain.ReleasePointerKindFlowDefinition, flow.Index) {
			continue
		}
		req := flow.Request
		req.ProjectID = input.ProjectID
		userSchema, err := resolveBundleOrProjectSchema(ctx, stmts, s.builtinBases, input.ProjectID, req.UserSchema, bundleSchemas)
		if err != nil {
			if errors.Is(err, domain.ErrJSONSchemaNotFound()) {
				failures.add(domain.ReleasePointerKindFlowDefinition, flow.Index, req.Name,
					domain.ErrReleaseUnresolvedReference().WithMessage(
						fmt.Sprintf("%s %s: user_schema %s not found",
							domain.ReleasePointerKindFlowDefinition, req.Name, req.UserSchema)))
				continue
			}
			if isBundleResourceFailure(err) {
				failures.add(domain.ReleasePointerKindFlowDefinition, flow.Index, req.Name, err)
				continue
			}
			return nil, err
		}
		definition, err := s.flows.prepareFlowDefinition(ctx, stmts, req, userSchema, bundleFlows)
		if err != nil {
			if isBundleResourceFailure(err) {
				failures.add(domain.ReleasePointerKindFlowDefinition, flow.Index, req.Name, err)
				continue
			}
			return nil, err
		}
		prepared = append(prepared, definition)
	}
	return prepared, nil
}

// activeBundleFlowNames maps flow names in the bundle that are active, so
// pivoting can target a sibling that is not yet persisted.
func activeBundleFlowNames(flows []BuildFlowDefinition) map[string]bool {
	out := make(map[string]bool, len(flows))
	for _, flow := range flows {
		name := strings.TrimSpace(flow.Request.Name)
		if name == "" {
			continue
		}
		status, err := domain.FlowDefinitionStatusString(flow.Request.Status)
		if err != nil {
			continue
		}
		if status == domain.FlowDefinitionStatusActive {
			out[name] = true
		}
	}
	return out
}

func resolveBundleOrProjectSchema(
	ctx context.Context,
	stmts AllStatements,
	bases domain.BuiltinSchemaBases,
	projectID, handle string,
	bundleSchemas map[string]*domain.JSONSchema,
) (*domain.JSONSchema, error) {
	if schema, ok := bundleSchemas[handle]; ok {
		return schema, nil
	}
	return newestUserSchema(ctx, stmts, bases, projectID, handle)
}

func (s *releaseService) prepareBundleIDPs(input BuildReleaseInput, failures *BundleValidationError) []preparedIDP {
	docs := make([]preparedIDP, 0, len(input.IDPs))
	for _, idp := range input.IDPs {
		if shapeFailed(failures, domain.ReleasePointerKindIDP, idp.Index) {
			continue
		}
		slug, err := s.idps.validate(idp.Document)
		if err != nil {
			failures.add(domain.ReleasePointerKindIDP, idp.Index, slug, err)
			continue
		}
		docs = append(docs, preparedIDP{index: idp.Index, slug: slug, document: idp.Document})
	}
	return docs
}

// prepareBundlePolicies validates each bundled policy against its
// operation's template before the transaction opens, the check
// `POST /policies` runs, so every refused config lands in the failures bag at
// once.
//
// Only a refused config is the bundle's fault: a template the engine cannot
// evaluate, or a config it cannot encode, is the server's, and fails the
// build as an internal error rather than a `rel.invalid` entry.
func (s *releaseService) prepareBundlePolicies(ctx context.Context, input BuildReleaseInput, failures *BundleValidationError) ([]preparedPolicy, error) {
	prepared := make([]preparedPolicy, 0, len(input.Policies))
	for _, policy := range input.Policies {
		if shapeFailed(failures, domain.ReleasePointerKindPolicy, policy.Index) {
			continue
		}
		config, err := s.policies.canonicalConfig(ctx, policy.Operation, policy.Config)
		if errors.Is(err, domain.ErrPolicyInvalid(nil, nil)) {
			failures.add(domain.ReleasePointerKindPolicy, policy.Index, policy.Operation, err)
			continue
		}
		if err != nil {
			return nil, err
		}
		prepared = append(prepared, preparedPolicy{operation: policy.Operation, config: config})
	}
	return prepared, nil
}

// checkBundleIDPImmutables runs the immutable-field check for each bundled
// IDP that already exists, so every violation lands in the failures bag
// before any write.
func (s *releaseService) checkBundleIDPImmutables(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	prepared []preparedIDP,
	failures *BundleValidationError,
) error {
	for _, idp := range prepared {
		existing, err := stmts.GetIDPConnection(ctx, idpConnectionBy(projectID, domain.IDPConnectionFieldSlug, idp.slug))
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			return domain.ErrInternal(err).WithMessage("failed to look up identity provider connection")
		}
		changed, err := domain.IDPConnectionImmutableFieldsChanged(existing.Document, idp.document)
		if err != nil {
			if isBundleResourceFailure(err) {
				failures.add(domain.ReleasePointerKindIDP, idp.index, idp.slug, err)
				continue
			}
			return err
		}
		if len(changed) > 0 {
			failures.add(domain.ReleasePointerKindIDP, idp.index, idp.slug,
				domain.ErrIDPConnectionFieldImmutable(map[string][]string{"fields": changed}))
		}
	}
	return nil
}

// isBundleResourceFailure reports whether err is a per-resource validation
// failure that belongs in the Build bag. Infrastructure errors (internal,
// aborted transactions, raw storage) must bubble so the caller can retry or
// answer with the real status.
func isBundleResourceFailure(err error) bool {
	de, ok := errors.AsType[domain.Error](err)
	if !ok {
		return false
	}
	return de.Code != domain.ErrInternal(nil).Code
}

// autoPinReferences adds project revisions for handles named by the bundle
// but not carried in it. A handle neither holds is left for ValidateRelease.
// Schema pins run first; IDP needs are collected afterwards so providers
// named only by an auto-pinned schema are still included.
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
	pointers, err := content.Pointers()
	if err != nil {
		return err
	}
	for _, pointer := range pointers {
		included[key{pointer.Kind, pointer.Handle}] = true
	}

	needSchema := map[string]struct{}{}
	for _, flow := range content.FlowDefinitions {
		if !included[key{domain.ReleasePointerKindSchema, flow.UserSchema}] {
			needSchema[flow.UserSchema] = struct{}{}
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

	needIDP := map[string]struct{}{}
	for _, flow := range content.FlowDefinitions {
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
