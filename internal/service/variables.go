package service

import (
	"context"
	"errors"
	"slices"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type VariableToSet struct {
	Name     string
	Value    any
	IsSecret bool
}

// VariableService reads and writes a project's variables (ADR 062). A name
// holds at most two values: the one every deploy freezes (applies_to all)
// and an optional override a preview deploy prefers.
type VariableService interface {
	// GetVariables reads the project's variables, for the given names (all
	// names when none are given). A nil appliesTo reads both values of a
	// name; otherwise only that one.
	GetVariables(ctx context.Context, projectID string, appliesTo *domain.VariableAppliesTo, names ...string) ([]*domain.Variable, error)
	GetDecryptedVariables(ctx context.Context, projectID string, appliesTo *domain.VariableAppliesTo, names ...string) ([]*domain.Variable, error)
	SetVariables(ctx context.Context, projectID string, appliesTo domain.VariableAppliesTo, variablesToSet []VariableToSet) error
	DeleteVariable(ctx context.Context, projectID string, appliesTo domain.VariableAppliesTo, name string) error
	// ResolveForDeploy picks the value each name runs under for a deploy:
	// the preview override where one exists and preview is set, else the
	// value for every deploy. The warnings name each secret that has no
	// preview value on a preview deploy, so the caller can say so.
	ResolveForDeploy(ctx context.Context, projectID string, preview bool) ([]*domain.Variable, []string, error)
	// ReplaceVariablesInPlace substitutes every `${{ NAME }}` in doc with the
	// value vars holds under that name, decrypting secrets.
	ReplaceVariablesInPlace(ctx context.Context, vars []*domain.Variable, doc map[string]any) error
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

func (s *variableService) GetVariables(ctx context.Context, projectID string, appliesTo *domain.VariableAppliesTo, names ...string) ([]*domain.Variable, error) {
	variables, err := s.v2Pool.Statements().GetVariables(ctx, projectID, appliesTo, names...)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	return variables, nil
}

func (s *variableService) GetDecryptedVariables(ctx context.Context, projectID string, appliesTo *domain.VariableAppliesTo, names ...string) ([]*domain.Variable, error) {
	variables, err := s.GetVariables(ctx, projectID, appliesTo, names...)
	if err != nil {
		return nil, err
	}
	return s.decryptAll(ctx, variables)
}

func (s *variableService) decryptAll(ctx context.Context, variables []*domain.Variable) ([]*domain.Variable, error) {

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
			decrypter = s.decrypterOfWritingKey(ctx)
		}
		value, err := variable.GetDecryptedValue(decrypter)
		if err != nil {
			return nil, domain.ErrFailedToDecryptVariable(err).WithDetails(map[string]any{"name": variable.Name})
		}
		decrypted = append(decrypted, &domain.Variable{
			Name:      variable.Name,
			Owner:     variable.Owner,
			AppliesTo: variable.AppliesTo,
			Value:     value,
			IsSecret:  true,
		})
	}
	return decrypted, nil
}

func (s *variableService) SetVariables(ctx context.Context, projectID string, appliesTo domain.VariableAppliesTo, variablesToSet []VariableToSet) error {
	if len(variablesToSet) == 0 {
		return nil
	}
	owner := domain.VariableOwner{ProjectID: projectID}

	var crypter crypto.Crypter
	var err error

	containsSecret := slices.ContainsFunc(variablesToSet, func(set VariableToSet) bool {
		return set.IsSecret
	})
	if containsSecret {
		crypter, err = s.keys.GetProjectCrypter(ctx, owner.ProjectID, domain.EncryptionKeyPurposeSecret)
		if err != nil {
			return err
		}
	}

	var varsToWrite []*domain.Variable
	var varsToDelete []string
	for _, varToSet := range variablesToSet {
		if varToSet.Value == nil {
			varsToDelete = append(varsToDelete, varToSet.Name)
			continue
		}
		if varToSet.IsSecret {
			v, err := domain.NewSecretVariable(varToSet.Name, owner, appliesTo, varToSet.Value, crypter)
			if err != nil {
				return err
			}
			varsToWrite = append(varsToWrite, v)
		} else {
			v, err := domain.NewVariable(varToSet.Name, owner, appliesTo, varToSet.Value)
			if err != nil {
				return err
			}
			varsToWrite = append(varsToWrite, v)
		}
	}

	// no need to start a transaction if there is only one variable -- but a
	// removal in the same batch is a second statement, and this path returns
	// before the loop below would run it.
	if len(varsToWrite) == 1 && len(varsToDelete) == 0 {
		err = s.v2Pool.Statements().SetVariable(ctx, varsToWrite[0])
		if err != nil {
			return setVariableError(err)
		}
		return nil
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		for _, name := range varsToDelete {
			err := tx.Statements().DeleteVariable(ctx, projectID, appliesTo, name)
			// Not DeleteVariable's "not found": a body states what the owner
			// holds afterwards, and a name it never held already satisfies
			// that. It is also what makes the request safe to retry.
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			if err != nil {
				return err
			}
		}
		for _, v := range varsToWrite {
			// The cause travels: a Spanner abort has to stay matchable for
			// ReadWriteTransaction to retry the callback.
			if err := tx.Statements().SetVariable(ctx, v); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return setVariableError(err)
	}
	return nil
}

// setVariableError names the one write failure a caller can act on: the
// project reference, reached only when the project is deleted between the
// request being resolved and the write.
func setVariableError(err error) error {
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return domain.ErrProjectNotFound().WithParent(err)
	}
	return domain.ErrInternal(err).WithMessage("failed to write variable to database")
}

func (s *variableService) DeleteVariable(ctx context.Context, projectID string, appliesTo domain.VariableAppliesTo, name string) error {
	if err := s.v2Pool.Statements().DeleteVariable(ctx, projectID, appliesTo, name); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrVariableNotFound().WithParent(err)
		}
		return domain.ErrInternal(err).WithMessage("failed to delete variable from database")
	}
	return nil
}

func (s *variableService) ResolveForDeploy(ctx context.Context, projectID string, preview bool) ([]*domain.Variable, []string, error) {
	all, err := s.GetVariables(ctx, projectID, nil)
	if err != nil {
		return nil, nil, err
	}
	resolved := domain.ResolveVariablesForDeploy(all, preview)
	var warnings []string
	if preview {
		for _, v := range resolved {
			if v.IsSecret && v.AppliesTo != domain.VariableAppliesToPreview {
				warnings = append(warnings, v.Name+" has no preview value; serving the production one. Set one: zitadel vars set "+v.Name+" --secret --preview")
			}
		}
	}
	return resolved, warnings, nil
}

func (s *variableService) ReplaceVariablesInPlace(ctx context.Context, vars []*domain.Variable, doc map[string]any) error {
	placeholders, err := domain.ScanDocumentForVariables(doc)
	if err != nil {
		return err
	}
	if len(placeholders) == 0 {
		return nil
	}

	varMap := domain.VariableListToMap(vars)

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
		varMap, err = domain.Variables(varMap).DecryptAll(s.decrypterOfWritingKey(ctx))
		if err != nil {
			return err
		}
	}

	if err := domain.ReplaceVariables(placeholders, varMap); err != nil {
		return err
	}

	return nil
}

func (s *variableService) decrypterOfWritingKey(ctx context.Context) crypto.Decrypter {
	crypters := make(map[string]crypto.Decrypter)

	return crypto.DecrypterFn(func(encrypted string) (string, error) {
		header, err := domain.DecodeJWEHeader(encrypted)
		if err != nil {
			return "", domain.ErrInternal(err).WithMessage("failed to decode the header of an encrypted variable")
		}

		crypter, ok := crypters[header.KeyID]
		if !ok {
			crypter, err = s.keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
			if err != nil {
				return "", err
			}
			crypters[header.KeyID] = crypter
		}
		return crypter.Decrypt(encrypted)
	})
}
