package configfs

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

// brandingHandle is the one handle branding has.
//
// Branding is the project's, not a named resource of its own: ADR 062 records
// its handle as the constant `default` because there is no naming field to use.
// The file tree follows that — `branding/default.json` is the project's
// branding — while the CLI's `branding.json` is accepted as the same document
// so a tree written by `zitadel setup` is readable without being renamed.
const brandingHandle = "default"

// cliBrandingFile is the name the CLI writes under `.zitadel/branding/`.
const cliBrandingFile = "branding"

// loadBrandings parses the project's branding document.
//
// The SQL dialects keep every published revision; a directory keeps the one
// the operator is editing. A list therefore returns at most one entry, which is
// the current branding — the same answer the SQL list's first row gives, since
// branding lists newest-first.
func (s *Store) loadBrandings() ([]*domain.Branding, error) {
	entries, err := s.readDir(brandingDir)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.Branding, 0, 1)
	for _, e := range entries {
		// Only the project's branding document is a branding resource. The
		// directory also holds the layout's liquid templates, which are assets
		// the document points at rather than resources of their own.
		if e.name != brandingHandle && e.name != cliBrandingFile {
			continue
		}
		modified, _ := modTime(e.path)
		// Branding revisions are minted per publish, so the id the CLI recorded
		// is the only way a release that pinned one still resolves here.
		b, err := branding.ToDomain(s.ProjectID(), s.resourceID(e, brandingHandle), modified, e.bytes)
		if err != nil {
			return nil, domain.ErrBrandingInvalid(
				"file "+e.path+" is not a valid branding document", err)
		}
		out = append(out, b)
	}
	return out, nil
}

// CreateBranding implements [service.BrandingStatements].
//
// A publish overwrites the document rather than appending a revision. Branding
// revisions are how the SQL dialects let a release pin an appearance; a
// directory is the working copy, and an operator iterating on a theme wants the
// next reload to show the edit, not a growing pile of files.
func (s *Statements) CreateBranding(ctx context.Context, entity *domain.Branding) error {
	if !s.config.store.serves(entity.ProjectID) {
		return domain.ErrBrandingInvalid("project is not served by the configuration directory", nil)
	}
	definition, err := branding.Marshal(entity)
	if err != nil {
		return err
	}
	if err := s.config.store.write(brandingDir, brandingHandle, indent(definition)); err != nil {
		return err
	}
	return s.config.rsi.UpsertResourceScope(ctx,
		domain.NewResourceScope(domain.ResourceKindBranding, entity.ProjectID, brandingHandle))
}

// GetBrandingByID implements [service.BrandingStatements].
func (s *Statements) GetBrandingByID(ctx context.Context, projectID, id string) (*domain.Branding, error) {
	if !s.config.store.serves(projectID) {
		return nil, new(database.NoRowFoundError)
	}
	brandings, err := s.config.store.loadBrandings()
	if err != nil {
		return nil, err
	}
	for _, b := range brandings {
		if b.ID == id {
			return b, nil
		}
	}
	return nil, new(database.NoRowFoundError)
}

// ListBrandings implements [service.BrandingStatements].
func (s *Statements) ListBrandings(
	ctx context.Context,
	filter *database.ListOptions[domain.BrandingField],
) (*database.ListResult[*domain.Branding], error) {
	if err := authz.RequireManagementListFilter(ctx); err != nil {
		return nil, err
	}

	brandings, err := s.config.store.loadBrandings()
	if err != nil {
		return nil, err
	}

	visible, err := s.visibleResourceIDs(ctx)
	if err != nil {
		return nil, err
	}
	if visible != nil {
		kept := brandings[:0]
		for _, b := range brandings {
			if _, ok := visible[b.ID]; ok {
				kept = append(kept, b)
			}
		}
		brandings = kept
	}

	return query(brandings, filter, branding.Schema)
}
