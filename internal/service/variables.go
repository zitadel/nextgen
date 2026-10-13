package service

import (
	"context"
	"errors"
	"slices"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type VariableToSet struct {
	Name     string
	Value    any
	IsSecret bool
}

// servedVariableKind is the kind ReplaceVariablesInPlace resolves against
// while documents are served from the store rather than from a deployment's
// frozen set.
const servedVariableKind = domain.OriginKindPrimary

// VariableService reads and writes a project's variables per kind (ADR 062,
// ADR 069).
//
// A nil kind addresses both kinds. Nothing falls back between them: a read of
// one kind never yields the other's value.
type VariableService interface {
	GetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.OriginKind, names ...string) ([]*domain.Variable, error)
	GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, names ...string) ([]*domain.Variable, error)
	SetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.OriginKind, variablesToSet []VariableToSet) error
	DeleteVariable(ctx context.Context, owner domain.VariableOwner, kind *domain.OriginKind, name string) error
	ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) error
}

type variableService struct {
	v2Pool *DB
	keys   KeyService
}

func NewVariableService(
	v2Pool *DB,
	keys KeyService,
) VariableService {
	return &variableService{
		v2Pool: v2Pool,
		keys:   keys,
	}
}

// addressedKinds is the kind named, or both.
func addressedKinds(kind *domain.OriginKind) []domain.OriginKind {
	if kind == nil {
		return domain.OriginKindValues()
	}
	return []domain.OriginKind{*kind}
}

func (s *variableService) GetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.OriginKind, names ...string) ([]*domain.Variable, error) {
	var variables []*domain.Variable
	for _, k := range addressedKinds(kind) {
		held, err := s.v2Pool.Statements().GetVariables(ctx, owner, k, names...)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to get variables from database")
		}
		variables = append(variables, held...)
	}
	return variables, nil
}

func (s *variableService) GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
	kind := servedVariableKind
	variables, err := s.GetVariables(ctx, owner, &kind, names...)
	if err != nil {
		return nil, err
	}

	// Built once and shared, so several secrets under one key cost one lookup;
	// built lazily, so a read holding no secret never reaches the key service.
	var decrypter crypto.Decrypter

	decrypted := make([]*domain.Variable, 0, len(variables))
	for _, variable := range variables {
		if !variable.IsSecret {
			decrypted = append(decrypted, variable)
			continue
		}
		if decrypter == nil {
			decrypter = decrypterOfWritingKey(ctx, s.keys)
		}
		value, err := variable.GetDecryptedValue(decrypter)
		if err != nil {
			return nil, domain.ErrFailedToDecryptVariable(err).WithDetails(map[string]any{"name": variable.Name})
		}
		decrypted = append(decrypted, &domain.Variable{
			Name:     variable.Name,
			Owner:    variable.Owner,
			Kind:     variable.Kind,
			Value:    value,
			IsSecret: true,
		})
	}
	return decrypted, nil
}

type variableRemoval struct {
	name string
	kind domain.OriginKind
}

// SetVariables applies one patch in one transaction. Naming no kind writes a
// plain value for both kinds and a secret for primary only, so a secret
// reaches previews only when asked to; a null removes the name from every
// kind addressed.
func (s *variableService) SetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.OriginKind, variablesToSet []VariableToSet) error {
	if len(variablesToSet) == 0 {
		return nil
	}

	var crypter crypto.Crypter
	var err error

	containsSecret := slices.ContainsFunc(variablesToSet, func(set VariableToSet) bool {
		return set.IsSecret && set.Value != nil
	})
	if containsSecret {
		crypter, err = s.keys.GetProjectCrypter(ctx, owner.ProjectID, domain.EncryptionKeyPurposeSecret)
		if err != nil {
			return err
		}
	}

	kinds := addressedKinds(kind)
	var varsToWrite []*domain.Variable
	var varsToRemove []variableRemoval
	for _, varToSet := range variablesToSet {
		if varToSet.Value == nil {
			for _, k := range kinds {
				varsToRemove = append(varsToRemove, variableRemoval{name: varToSet.Name, kind: k})
			}
			continue
		}
		var v *domain.Variable
		if varToSet.IsSecret {
			v, err = domain.NewSecretVariable(varToSet.Name, owner, varToSet.Value, crypter)
		} else {
			v, err = domain.NewVariable(varToSet.Name, owner, varToSet.Value)
		}
		if err != nil {
			return err
		}
		targets := kinds
		if varToSet.IsSecret && kind == nil {
			targets = []domain.OriginKind{domain.OriginKindPrimary}
		}
		for _, k := range targets {
			perKind := *v
			perKind.Kind = k
			varsToWrite = append(varsToWrite, &perKind)
		}
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		held := make(map[domain.OriginKind]map[string]*domain.Variable, len(kinds))
		for _, k := range domain.OriginKindValues() {
			variables, err := tx.Statements().GetVariables(ctx, owner, k)
			if err != nil {
				return err
			}
			held[k] = domain.VariableListToMap(variables)
		}

		for _, removal := range varsToRemove {
			// A name the kind never held is no error: a patch states what the
			// project holds afterwards, which also makes a retry safe.
			removed, ok := held[removal.kind][removal.name]
			if !ok {
				continue
			}
			if err := tx.Statements().DeleteVariable(ctx, owner, removal.kind, removal.name); err != nil {
				return err
			}
			delete(held[removal.kind], removal.name)
			if err := emitVariableEvent(ctx, tx.Statements(), domain.EventTypeVariableRemoved, removed); err != nil {
				return err
			}
		}
		for _, v := range varsToWrite {
			// The cause travels: a Spanner abort has to stay matchable for
			// ReadWriteTransaction to retry the callback.
			if err := tx.Statements().SetVariable(ctx, v); err != nil {
				return err
			}
			held[v.Kind][v.Name] = v
			if err := emitVariableEvent(ctx, tx.Statements(), domain.EventTypeVariableSet, v); err != nil {
				return err
			}
		}
		for _, variables := range held {
			if len(variables) > domain.MaxVariablesPerKind {
				return domain.ErrTooManyVariables()
			}
		}
		return nil
	})
	if err != nil {
		return setVariableError(err)
	}
	return nil
}

func emitVariableEvent(ctx context.Context, stmts EventStatements, eventType domain.EventType, v *domain.Variable) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  v.Owner.ProjectID,
		EntityType: "variable",
		EntityID:   v.Name,
		Payload:    domain.VariablePayload{Kind: v.Kind.String(), Secret: v.IsSecret},
	})
}

// setVariableError keeps a domain error as it is. The project reference is the
// one foreign key a write can trip: the project was resolved from the request,
// so it was deleted between the access check and the write.
func setVariableError(err error) error {
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return domain.ErrProjectNotFound().WithParent(err)
	}
	return domain.ErrInternal(err).WithMessage("failed to write variable to database")
}

// DeleteVariable removes name from every kind addressed. It is not found only
// when none of them held it.
func (s *variableService) DeleteVariable(ctx context.Context, owner domain.VariableOwner, kind *domain.OriginKind, name string) error {
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var removed bool
		for _, k := range addressedKinds(kind) {
			held, err := tx.Statements().GetVariables(ctx, owner, k, name)
			if err != nil {
				return err
			}
			if len(held) == 0 {
				continue
			}
			if err := tx.Statements().DeleteVariable(ctx, owner, k, name); err != nil {
				return err
			}
			if err := emitVariableEvent(ctx, tx.Statements(), domain.EventTypeVariableRemoved, held[0]); err != nil {
				return err
			}
			removed = true
		}
		if !removed {
			return domain.ErrVariableNotFound()
		}
		return nil
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to delete variable from database")
	}
	return nil
}

func (s *variableService) ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) error {
	placeholders, err := domain.ScanDocumentForVariables(doc)
	if err != nil {
		return err
	}
	if len(placeholders) == 0 {
		return nil
	}

	// One name per query term, however many placeholders reference it.
	variableNames := make([]string, 0, len(placeholders))
	seen := make(map[string]bool, len(placeholders))
	for _, placeholder := range placeholders {
		if seen[placeholder.VariableName] {
			continue
		}
		seen[placeholder.VariableName] = true
		variableNames = append(variableNames, placeholder.VariableName)
	}

	varList, err := s.v2Pool.Statements().GetVariables(ctx, owner, servedVariableKind, variableNames...)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	varMap := domain.VariableListToMap(varList)

	if err := domain.ValidateSecretPlaceholders(placeholders, varMap); err != nil {
		return err
	}

	var containsSecrets bool
	for _, v := range varMap {
		if v.IsSecret {
			containsSecrets = true
			break
		}
	}

	if containsSecrets {
		varMap, err = domain.Variables(varMap).DecryptAll(decrypterOfWritingKey(ctx, s.keys))
		if err != nil {
			return err
		}
	}

	if err := domain.ReplaceVariables(placeholders, varMap); err != nil {
		return err
	}

	return nil
}

// decrypterOfWritingKey decrypts with the key each ciphertext names in its JWE
// header, not the owner's currently active key, so a value written before a
// rotation still decrypts. Variables and the SSO callback's PKCE verifier both
// decrypt through this.
func decrypterOfWritingKey(ctx context.Context, keys KeyService) crypto.Decrypter {
	crypters := make(map[string]crypto.Decrypter)

	return crypto.DecrypterFn(func(encrypted string) (string, error) {
		header, err := domain.DecodeJWEHeader(encrypted)
		if err != nil {
			return "", domain.ErrInternal(err).WithMessage("failed to decode the header of an encrypted value")
		}

		crypter, ok := crypters[header.KeyID]
		if !ok {
			crypter, err = keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
			if err != nil {
				return "", err
			}
			crypters[header.KeyID] = crypter
		}
		return crypter.Decrypt(encrypted)
	})
}
