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

	set, err := s.v2Pool.Statements().GetDeploymentVariables(ctx, projectID, deploymentID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrDeploymentNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get deployment variables")
	}
	return set, nil
}

// resolveDeploymentVariableSet is the set create would attach. A rollback
// reuses the restored deployment's set. Anything else freezes the live rows
// of the deployment's kind, including the empty set.
func resolveDeploymentVariableSet(ctx context.Context, stmts AllStatements, entity *domain.Deployment) (*domain.VariableSet, error) {
	if entity.Metadata.RollbackTo != nil {
		set, err := stmts.GetDeploymentVariables(ctx, entity.ProjectID, *entity.Metadata.RollbackTo)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return nil, domain.ErrDeploymentNotFound()
			}
			return nil, domain.ErrInternal(err).WithMessage("failed to read the restored deployment's variables")
		}
		return set, nil
	}
	variables, err := stmts.GetVariables(ctx, domain.VariableOwner{ProjectID: entity.ProjectID}, entity.OriginKind)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read variables")
	}
	return domain.NewVariableSet(entity.ProjectID, variables)
}

// deploymentSetHash is the set current runs with. No deployment, or one that
// was never frozen, has no hash, so it cannot match the set being written.
func deploymentSetHash(ctx context.Context, stmts VariableSetStatements, current *domain.Deployment) (string, error) {
	if current == nil {
		return "", nil
	}
	set, err := stmts.GetDeploymentVariables(ctx, current.ProjectID, current.ID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return "", nil
		}
		return "", domain.ErrInternal(err).WithMessage("failed to read the deployment's variables")
	}
	return set.Hash, nil
}

// attachVariableSet links a rollback to the set it resolved, and freezes the
// live rows for every other deploy. Freeze re-reads those rows in this
// transaction, which is what inserts the set when its hash is new.
func attachVariableSet(ctx context.Context, stmts VariableSetStatements, written *domain.Deployment, set *domain.VariableSet) error {
	if written.Metadata.RollbackTo != nil {
		return stmts.LinkDeploymentVariableSet(ctx, written.ProjectID, written.ID, set.Hash)
	}
	_, err := stmts.FreezeDeploymentVariables(ctx, written.ProjectID, written.ID)
	return err
}

// missingVariableNames is every ${{ NAME }} in the release's pinned documents
// that set does not hold, each name once. The set still holds every row of
// its kind: a name the release does not mention stays in it.
func missingVariableNames(ctx context.Context, stmts AllStatements, projectID string, release *domain.Release, set *domain.VariableSet) ([]string, error) {
	present := make(map[string]bool, len(set.Entries))
	for _, entry := range set.Entries {
		present[entry.Name] = true
	}
	seen := make(map[string]struct{})
	var missing []string
	for _, pointer := range release.Pointers {
		doc, err := releasePointerDocument(ctx, stmts, projectID, pointer)
		if err != nil {
			return nil, err
		}
		if doc == nil {
			continue
		}
		placeholders, err := domain.ScanDocumentForVariables(doc)
		if err != nil {
			return nil, err
		}
		for _, placeholder := range placeholders {
			if _, ok := seen[placeholder.VariableName]; ok {
				continue
			}
			seen[placeholder.VariableName] = struct{}{}
			if !present[placeholder.VariableName] {
				missing = append(missing, placeholder.VariableName)
			}
		}
	}
	return missing, nil
}

func releasePointerDocument(ctx context.Context, stmts AllStatements, projectID string, pointer domain.ReleasePointer) (map[string]any, error) {
	switch pointer.Kind {
	case domain.ReleasePointerKindSchema:
		schema, err := stmts.GetJSONSchemaByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		return jsonObject(schema.Schema)
	case domain.ReleasePointerKindFlowDefinition:
		definition, err := stmts.GetFlowDefinitionByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		raw, err := flowdefinition.Marshal(definition)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read a flow definition")
		}
		return jsonObject(raw)
	case domain.ReleasePointerKindIDP:
		connection, err := stmts.GetIDPConnectionRevision(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		return jsonObject(connection.Document)
	case domain.ReleasePointerKindBranding:
		branding, err := stmts.GetBrandingByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return nil, revisionReadError(err)
		}
		raw, err := json.Marshal(branding)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read a branding revision")
		}
		return jsonObject(raw)
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

// jsonObject is a JSON object, the only shape ScanDocumentForVariables walks.
// A value that is not an object has no placeholders. Invalid JSON is ours.
func jsonObject(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err == nil {
		return doc, nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read a release document")
	}
	return nil, nil
}
