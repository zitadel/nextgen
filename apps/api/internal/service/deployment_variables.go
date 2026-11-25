package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

// Variables returns the set deploymentID froze. A deployment that was never
// frozen answers not found, the same as one the project does not hold: an
// empty set is a successful freeze of a project with no variables.
func (s *DeploymentService) Variables(ctx context.Context, projectID, deploymentID string) (_ *domain.VariableSet, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.Variables")
	defer end(&err)

	set, err := s.variables.GetDeploymentVariables(ctx, projectID, deploymentID)
	if err != nil {
		if errors.Is(err, errNoFrozenVariables) {
			return nil, domain.ErrDeploymentNotFound()
		}
		return nil, err
	}
	return set, nil
}

// resolveDeploymentVariableSet is the set create would attach. A rollback
// reuses the restored deployment's set and does not scan: that release and
// set already passed the check. Anything else builds the set from the live
// rows of the deployment's kind, including the empty set, and refuses the
// deploy when the release names a variable that set does not hold, or names
// as a client secret one that is plain or does not decrypt to a non-empty
// string: a client could never authenticate with it.
func resolveDeploymentVariableSet(ctx context.Context, variables VariableService, stmts AllStatements, entity *domain.Deployment, release *domain.Release) (*domain.VariableSet, error) {
	if entity.Metadata.RollbackTo != nil {
		set, err := variables.ReadDeploymentVariableSet(ctx, stmts, entity.ProjectID, *entity.Metadata.RollbackTo)
		if err != nil {
			if errors.Is(err, errNoFrozenVariables) {
				return nil, domain.ErrDeploymentNotFound()
			}
			return nil, err
		}
		return set, nil
	}
	set, err := variables.NewKindVariableSet(ctx, stmts, entity.ProjectID, entity.OriginKind)
	if err != nil {
		return nil, err
	}
	names, secrets, err := releaseVariableNames(ctx, stmts, entity.ProjectID, release)
	if err != nil {
		return nil, err
	}
	held := make(map[string]domain.VariableSetEntry, len(set.Entries))
	for _, entry := range set.Entries {
		held[entry.Name] = entry
	}
	var missing, plain, secret []string
	for _, name := range names {
		entry, ok := held[name]
		if !ok {
			missing = append(missing, name)
			continue
		}
		if !secrets[name] {
			continue
		}
		if entry.IsSecret {
			secret = append(secret, name)
		} else {
			plain = append(plain, name)
		}
	}
	if len(missing) > 0 {
		return nil, domain.ErrDeploymentVariablesMissing(entity.OriginKind, missing)
	}
	values, err := variables.DecryptVariableSetSecrets(ctx, set, secret...)
	if err != nil {
		return nil, err
	}
	for _, name := range secret {
		if value, _ := values[name].(string); value == "" {
			plain = append(plain, name)
		}
	}
	if len(plain) > 0 {
		return nil, domain.ErrDeploymentVariablesNotSecret(entity.OriginKind, plain)
	}
	return set, nil
}

// deploymentSetHash is the set current runs with. No deployment, or one that
// was never frozen, has no hash, so it cannot match the set being written.
func deploymentSetHash(ctx context.Context, variables VariableService, stmts VariableSetStatements, current *domain.Deployment) (string, error) {
	if current == nil {
		return "", nil
	}
	set, err := variables.ReadDeploymentVariableSet(ctx, stmts, current.ProjectID, current.ID)
	if err != nil {
		if errors.Is(err, errNoFrozenVariables) {
			return "", nil
		}
		return "", err
	}
	return set.Hash, nil
}

// releaseVariableNames is every variable the release's pinned documents
// reference, each name once, and which of them hold a client secret: an
// application client's or an identity provider's. An application resolves
// only its clients' secrets, so only those count: a ${{ NAME }} elsewhere in
// it is served as written.
func releaseVariableNames(ctx context.Context, stmts AllStatements, projectID string, release *domain.Release) ([]string, map[string]bool, error) {
	seen := make(map[string]bool)
	secrets := make(map[string]bool)
	var names []string
	add := func(name string) {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	for _, pointer := range release.Pointers {
		raw, err := releasePointerDocument(ctx, stmts, projectID, pointer)
		if err != nil {
			return nil, nil, err
		}
		if len(raw) == 0 {
			continue
		}
		switch pointer.Kind {
		case domain.ReleasePointerKindApplication:
			doc, err := domain.ParseApplicationDocument(raw)
			if err != nil {
				return nil, nil, domain.ErrInternal(err).WithMessage("failed to read a release document")
			}
			for _, client := range doc.Clients {
				if name, ok := client.SecretVariable(); ok {
					add(name)
					secrets[name] = true
				}
			}
			continue
		case domain.ReleasePointerKindIDP:
			var connection struct {
				OIDC struct {
					ClientSecret string `json:"client_secret"`
				} `json:"oidc"`
			}
			if err := json.Unmarshal(raw, &connection); err != nil {
				return nil, nil, domain.ErrInternal(err).WithMessage("failed to read a release document")
			}
			if name, ok := domain.VariableReferenceName(connection.OIDC.ClientSecret); ok {
				secrets[name] = true
			}
		}
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, nil, domain.ErrInternal(err).WithMessage("failed to read a release document")
		}
		doc, ok := value.(map[string]any)
		if !ok {
			continue
		}
		placeholders, err := domain.ScanDocumentForVariables(doc)
		if err != nil {
			return nil, nil, err
		}
		for _, placeholder := range placeholders {
			add(placeholder.VariableName)
		}
	}
	return names, secrets, nil
}

func releasePointerDocument(ctx context.Context, stmts AllStatements, projectID string, pointer domain.ReleasePointer) ([]byte, error) {
	switch pointer.Kind {
	case domain.ReleasePointerKindSchema:
		schema, err := stmts.GetJSONSchemaByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		return schema.Schema, nil
	case domain.ReleasePointerKindFlowDefinition:
		definition, err := stmts.GetFlowDefinitionByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		raw, err := flowdefinition.Marshal(definition)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read a flow definition")
		}
		return raw, nil
	case domain.ReleasePointerKindIDP:
		connection, err := stmts.GetIDPConnectionRevision(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		return connection.Document, nil
	case domain.ReleasePointerKindApplication:
		application, err := stmts.GetApplicationRevision(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		return application.Document, nil
	case domain.ReleasePointerKindPolicy:
		revision, err := stmts.GetPolicyRevision(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		return revision.Config, nil
	case domain.ReleasePointerKindBranding:
		branding, err := stmts.GetBrandingByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		raw, err := json.Marshal(branding)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read a branding revision")
		}
		return raw, nil
	case domain.ReleasePointerKindOauth:
		return nil, nil // an OAuth settings revision holds no variables
	default:
		return nil, domain.ErrInternal(nil).WithMessage(fmt.Sprintf("unknown release pointer kind %d", pointer.Kind))
	}
}

func revisionReadError(err error) error {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrInternal(err).WithMessage("pinned revision is missing")
	}
	return domain.ErrInternal(err).WithMessage("failed to read a pinned revision")
}
