package configfs

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

// flowFile is one document under `flows/`.
//
// It is the shape `zitadel setup` writes and a developer edits, not a storage
// envelope wrapped around it: the row columns a flow needs beyond its content
// (`name`, `status`, `schema_version`) sit alongside the content fields rather
// than nested under a key, which is what `packages/config/defaults/default-login.json`
// already looks like. Embedding Content means the nested half is encoded by the
// same helpers the SQL dialects use for their definition column, so a flow
// round-trips through a file exactly as it round-trips through a row.
type flowFile struct {
	Name          string `json:"name"`
	Status        string `json:"status,omitempty"`
	SchemaVersion string `json:"schema_version,omitempty"`
	flowdefinition.Content
}

// loadFlowDefinitions parses every document under `flows/`.
func (s *Store) loadFlowDefinitions() ([]*domain.FlowDefinition, error) {
	entries, err := s.readDir(flowsDir)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.FlowDefinition, 0, len(entries))
	for _, e := range entries {
		def, err := s.flowFromFile(e)
		if err != nil {
			return nil, err
		}
		out = append(out, def)
	}
	return out, nil
}

func (s *Store) flowFromFile(e entry) (*domain.FlowDefinition, error) {
	var file flowFile
	if err := json.Unmarshal(e.bytes, &file); err != nil {
		return nil, domain.ErrFlowDefinitionInvalid(
			fmt.Sprintf("file %s is not a valid flow definition document", e.path), err)
	}

	// The file name is the fallback handle so a document that omits `name`
	// still has a stable identity rather than colliding with every other
	// unnamed flow on the empty string.
	name := file.Name
	if name == "" {
		name = e.name
	}

	status := domain.FlowDefinitionStatusActive
	if file.Status != "" {
		parsed, err := domain.FlowDefinitionStatusString(file.Status)
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid(
				fmt.Sprintf("file %s declares unknown status %q", e.path, file.Status), err)
		}
		status = parsed
	}

	content, err := json.Marshal(file.Content)
	if err != nil {
		return nil, err
	}

	modified, _ := modTime(e.path)
	// The id is the one the CLI recorded for this file, falling back to the
	// flow's name when the index has no entry. Either way it is stable across
	// edits: the tree holds the current revision of each resource, and an id
	// that changed on every save would break the reference a release or a
	// running flow holds at exactly the moment the operator is editing to see
	// the effect.
	return flowdefinition.ToDomain(
		s.ProjectID(),
		s.resourceID(e, name),
		name,
		file.SchemaVersion,
		status,
		modified,
		modified,
		content,
	)
}

// CreateFlowDefinition implements [service.FlowDefinitionStatements].
func (s *Statements) CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	if !s.config.store.serves(entity.ProjectID) {
		return domain.ErrFlowDefinitionInvalid("project is not served by the configuration directory", nil)
	}

	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	file := flowFile{
		Name:          entity.Name,
		Status:        entity.Status.String(),
		SchemaVersion: entity.SchemaVersion,
	}
	if err := json.Unmarshal(content, &file.Content); err != nil {
		return err
	}
	// Indented so the file stays something a human edits and a diff reads,
	// which is the whole reason the configuration lives on disk.
	encoded, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := s.config.store.write(flowsDir, fileName(entity.Name), encoded); err != nil {
		return err
	}
	return s.config.rsi.UpsertResourceScope(ctx,
		domain.NewResourceScope(domain.ResourceKindFlowDefinition, entity.ProjectID, entity.Name))
}

// GetFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (s *Statements) GetFlowDefinitionByID(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error) {
	if !s.config.store.serves(projectID) {
		return nil, new(database.NoRowFoundError)
	}
	defs, err := s.config.store.loadFlowDefinitions()
	if err != nil {
		return nil, err
	}
	for _, def := range defs {
		if def.ID == id {
			return def, nil
		}
	}
	return nil, new(database.NoRowFoundError)
}

// ListFlowDefinitions implements [service.FlowDefinitionStatements].
func (s *Statements) ListFlowDefinitions(
	ctx context.Context,
	filter *database.ListOptions[domain.FlowDefinitionField],
	opts service.FlowDefinitionQueryOptions,
) (*database.ListResult[*domain.FlowDefinition], error) {
	if err := authz.RequireManagementListFilter(ctx); err != nil {
		return nil, err
	}

	defs, err := s.config.store.loadFlowDefinitions()
	if err != nil {
		return nil, err
	}

	visible, err := s.visibleResourceIDs(ctx)
	if err != nil {
		return nil, err
	}
	if visible != nil {
		kept := defs[:0]
		for _, def := range defs {
			if _, ok := visible[def.ID]; ok {
				kept = append(kept, def)
			}
		}
		defs = kept
	}

	return query(defs, flowdefinition.EnsureListOptions(filter), flowdefinition.Schema)
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (s *Statements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	if !s.config.store.serves(projectID) {
		return new(database.NoRowFoundError)
	}
	def, err := s.GetFlowDefinitionByID(ctx, projectID, id)
	if err != nil {
		return err
	}
	if err := s.config.store.remove(flowsDir, fileName(def.Name)); err != nil {
		return err
	}
	return s.config.rsi.DeleteResourceScope(ctx, domain.ResourceKindFlowDefinition, projectID, id)
}
