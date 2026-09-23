package api

import (
	"context"
	"sort"
	"sync"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// This file is a stub for the identity provider connection endpoints, so the
// CLI's connection syncer can be built and exercised against a local server
// before the real service lands (#1003). It is deliberately the whole
// implementation, in one file, so replacing it is a deletion.
//
// What it is not: connections are held in this process's memory, so they do
// not survive a restart, are not shared between replicas, and are not written
// to any table. Revision history is not kept — `revision_id` is allocated per
// write, and the revision endpoints stay unimplemented. The document is stored
// as received: the schema validation, the immutable-field rules
// (`domain.ErrIDPConnectionFieldImmutable`) and authorization scoping are the
// real service's to enforce.

// idpStubRecord is one connection as this stub holds it.
type idpStubRecord struct {
	id         string
	revisionID string
	slug       string
	createdAt  time.Time
	updatedAt  time.Time
	definition api.IdpConnection
}

// idpStubStore keeps connections per project, keyed by slug, which is what
// `createIdp` dedupes on: a document whose slug exists revises that
// connection rather than creating a second one.
type idpStubStore struct {
	mu        sync.Mutex
	byProject map[string]map[string]*idpStubRecord
}

func newIdpStubStore() *idpStubStore {
	return &idpStubStore{byProject: map[string]map[string]*idpStubRecord{}}
}

func (s *idpStubStore) upsert(projectID string, definition api.IdpConnection, mint func(domain.ResourcePrefix) (string, error), now time.Time) (*idpStubRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	project, ok := s.byProject[projectID]
	if !ok {
		project = map[string]*idpStubRecord{}
		s.byProject[projectID] = project
	}
	revisionID, err := mint(domain.PrefixIDPConnection)
	if err != nil {
		return nil, false, err
	}
	if existing, ok := project[definition.Slug]; ok {
		// A revision keeps the connection id, so identity links that
		// reference it keep resolving.
		existing.revisionID = revisionID
		existing.updatedAt = now
		existing.definition = definition
		return existing, false, nil
	}
	id, err := mint(domain.PrefixIDPConnection)
	if err != nil {
		return nil, false, err
	}
	record := &idpStubRecord{
		id:         id,
		revisionID: revisionID,
		slug:       definition.Slug,
		createdAt:  now,
		updatedAt:  now,
		definition: definition,
	}
	project[definition.Slug] = record
	return record, true, nil
}

func (s *idpStubStore) list(projectID string) []*idpStubRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]*idpStubRecord, 0, len(s.byProject[projectID]))
	for _, record := range s.byProject[projectID] {
		records = append(records, record)
	}
	// Oldest first, as the query's default sort promises.
	sort.Slice(records, func(i, j int) bool {
		if records[i].createdAt.Equal(records[j].createdAt) {
			return records[i].id < records[j].id
		}
		return records[i].createdAt.Before(records[j].createdAt)
	})
	return records
}

func (s *idpStubStore) get(projectID, id string) (*idpStubRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, record := range s.byProject[projectID] {
		if record.id == id {
			return record, true
		}
	}
	return nil, false
}

func (r *idpStubRecord) response() api.IdpResponse {
	return api.IdpResponse{
		ID:         r.id,
		RevisionID: r.revisionID,
		Slug:       r.slug,
		CreatedAt:  r.createdAt,
		UpdatedAt:  r.updatedAt,
		Definition: r.definition,
	}
}

// idpAccess gates the connection endpoints. Every one of them carries a
// project id, so no resource-kind check applies (see resourceAccess.kind).
// A denial answers not-found like a miss, so a caller without access cannot
// learn whether a connection exists.
var idpAccess = resourceAccess{
	readMiss:  domain.ErrIDPConnectionNotFound,
	writeMiss: domain.ErrIDPConnectionNotFound,
	denied:    domain.ErrIDPConnectionNotFound,
}

func (h *Handler) mintID(ctx context.Context, prefix domain.ResourcePrefix) (string, error) {
	return h.pool.Statements().NewManagedID(string(prefix))
}

// CreateIdp creates a connection, or revises the one that already holds the
// document's slug. Stub: see the note at the top of this file.
func (h *Handler) CreateIdp(ctx context.Context, req *api.CreateIdpRequest, params api.CreateIdpParams) (api.CreateIdpRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), idpAccess, opWrite); err != nil {
		return nil, err
	}
	record, created, err := h.idpStub.upsert(
		string(params.ProjectID),
		req.Idp,
		func(prefix domain.ResourcePrefix) (string, error) { return h.mintID(ctx, prefix) },
		time.Now().UTC(),
	)
	if err != nil {
		return nil, err
	}
	if created {
		response := api.CreateIdpCreated(record.response())
		return &response, nil
	}
	response := api.CreateIdpOK(record.response())
	return &response, nil
}

// GetIdpById returns the newest revision of one connection. Stub.
func (h *Handler) GetIdpById(ctx context.Context, params api.GetIdpByIdParams) (api.GetIdpByIdRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, idpAccess, opRead); err != nil {
		return nil, err
	}
	record, ok := h.idpStub.get(projectID, params.ID)
	if !ok {
		return nil, domain.ErrIDPConnectionNotFound()
	}
	response := record.response()
	return &response, nil
}

// QueryIdps lists the project's connections, oldest first. Stub: the whole
// list is returned, so paging inputs are accepted and ignored.
func (h *Handler) QueryIdps(ctx context.Context, req *api.QueryIdpsRequest, params api.QueryIdpsParams) (api.QueryIdpsRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, idpAccess, opRead); err != nil {
		return nil, err
	}
	records := h.idpStub.list(projectID)
	idps := make([]api.IdpResponse, 0, len(records))
	for _, record := range records {
		idps = append(idps, record.response())
	}
	return &api.QueryIdpsResponse{Idps: idps}, nil
}
