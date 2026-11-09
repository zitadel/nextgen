package application

import (
	"bytes"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
)

// EnsureClientIDs gives each client a primary key from ensure, the dialect's
// generator, and a client without a client_id a copy of it (ADR 047 §5).
func EnsureClientIDs(entity *domain.Application, clients []*domain.ApplicationClient, ensure func(*string, domain.ResourcePrefix) error) error {
	for _, client := range clients {
		if err := ensure(&client.ID, domain.PrefixApplicationClient); err != nil {
			return err
		}
		if client.ClientID == "" {
			client.ClientID = client.ID
		}
		client.ProjectID, client.ApplicationID = entity.ProjectID, entity.ID
	}
	return nil
}

// FillClientIDs returns document with each client's client_id taken from the
// client row of the same slug. The contract requires the stored document to
// hold every id: a generated one, and a stored one a revision left out. The
// document is patched as a map, so fields domain.ApplicationDocument does not
// model are kept.
func FillClientIDs(document []byte, clients ...*domain.ApplicationClient) ([]byte, error) {
	var doc map[string]any
	decoder := json.NewDecoder(bytes.NewReader(document))
	decoder.UseNumber()
	if err := decoder.Decode(&doc); err != nil {
		return nil, err
	}
	clientIDs := make(map[string]string, len(clients))
	for _, client := range clients {
		clientIDs[client.Slug] = client.ClientID
	}
	docClients, _ := doc["clients"].([]any)
	for _, docClient := range docClients {
		fields, ok := docClient.(map[string]any)
		if !ok {
			continue
		}
		slug, _ := fields["slug"].(string)
		if clientID, ok := clientIDs[slug]; ok {
			fields["client_id"] = clientID
		}
	}
	return json.Marshal(doc)
}
