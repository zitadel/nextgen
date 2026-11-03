package stage

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
)

// Doc is the folded state of one v4 aggregate.
type Doc interface {
	apply(e v4.Event) error
}

// NewDoc returns an empty document for the aggregate type, nil for a type the
// stage does not fold.
func NewDoc(aggregateType string) Doc {
	switch aggregateType {
	case AggregateInstance:
		return &Instance{}
	case AggregateOrg:
		return &Org{}
	case AggregateUser:
		return &User{}
	case AggregateProject, AggregateUserGrant, AggregateAction, AggregateTarget,
		AggregateExecution, AggregateSchema:
		return &Object{}
	}
	return nil
}

// Staged is one staged aggregate: its document and the sequence of the newest
// event folded into it.
type Staged struct {
	Key      v4.AggregateKey
	Sequence int64
	Doc      Doc
}

// Fold applies the aggregate's events in sequence order. An event at or below
// the staged sequence is already in the document and skipped.
func (s *Staged) Fold(events []v4.Event) error {
	for _, e := range events {
		if e.Sequence <= s.Sequence {
			continue
		}
		if err := s.Doc.apply(e); err != nil {
			return fmt.Errorf("%s %s sequence %d (%s): %w", e.AggregateType, e.AggregateID, e.Sequence, e.Type, err)
		}
		s.Sequence = e.Sequence
	}
	return nil
}

// EventTypes lists every event the stage folds, per aggregate type.
func EventTypes() map[string][]string {
	instance := []string{
		"instance.added", "instance.changed", "instance.removed",
		"instance.default.org.set", "instance.iam.project.set",
		"instance.domain.added", "instance.domain.primary.set", "instance.domain.removed",
		"instance.trusted_domains.added", "instance.trusted_domains.removed",
		"instance.policy.domain.added", "instance.policy.domain.changed",
		"instance.policy.login.added", "instance.policy.login.changed",
		"instance.policy.login.idpprovider.added", "instance.policy.login.idpprovider.removed",
		"instance.policy.login.idpprovider.cascade.removed",
	}
	instance = append(instance, idpEventTypes("instance.", "iam.")...)
	org := []string{
		"org.added", "org.changed", "org.deactivated", "org.reactivated", "org.removed",
		"org.domain.added", "org.domain.verified", "org.domain.primary.set", "org.domain.removed",
		"org.policy.domain.added", "org.policy.domain.changed", "org.policy.domain.removed",
		"org.policy.login.added", "org.policy.login.changed", "org.policy.login.removed",
		"org.policy.login.idpprovider.added", "org.policy.login.idpprovider.removed",
		"org.policy.login.idpprovider.cascade.removed",
	}
	org = append(org, idpEventTypes("org.", "org.")...)
	user := []string{
		// human, and the v1 names old data still carries
		"user.human.added", "user.human.selfregistered", "user.added", "user.selfregistered",
		"user.human.initialization.code.added", "user.initialization.code.added",
		"user.human.initialization.check.succeeded", "user.initialization.check.succeeded",
		"user.human.profile.changed", "user.profile.changed",
		"user.human.email.changed", "user.email.changed",
		"user.human.email.verified", "user.email.verified",
		"user.human.phone.changed", "user.phone.changed",
		"user.human.phone.verified", "user.phone.verified",
		"user.human.phone.removed", "user.phone.removed",
		"user.human.password.changed", "user.password.changed",
		"user.human.password.hash.updated",
		"user.human.address.changed", "user.address.changed",
		"user.human.avatar.added", "user.human.avatar.removed",
		"user.username.changed", "user.domain.claimed",
		"user.locked", "user.unlocked", "user.deactivated", "user.reactivated", "user.removed",
		"user.human.externalidp.added", "user.human.externalidp.removed",
		"user.human.externalidp.cascade.removed", "user.human.externalidp.id.migrated",
		"user.human.mfa.otp.added", "user.mfa.otp.added",
		"user.human.mfa.otp.verified", "user.mfa.otp.verified",
		"user.human.mfa.otp.removed", "user.mfa.otp.removed",
		"user.human.mfa.otp.sms.added", "user.human.mfa.otp.sms.removed",
		"user.human.mfa.otp.email.added", "user.human.mfa.otp.email.removed",
		"user.human.mfa.u2f.token.verified", "user.human.mfa.u2f.token.removed",
		"user.human.passwordless.token.verified", "user.human.passwordless.token.removed",
		"user.human.mfa.recoverycode.added", "user.human.mfa.recoverycode.removed",
		"user.metadata.set", "user.metadata.removed", "user.metadata.removed.all",
		// machine
		"user.machine.added", "user.machine.key.added", "user.machine.key.removed",
		"user.machine.secret.set", "user.machine.secret.removed",
		"user.pat.added", "user.pat.removed",
	}
	return map[string][]string{
		AggregateInstance: instance,
		AggregateOrg:      org,
		AggregateUser:     user,
		AggregateProject: {
			"project.added", "project.removed",
			"project.application.added", "project.application.removed",
			"project.role.added", "project.role.removed",
			"project.grant.added", "project.grant.removed", "project.grant.cascade.removed",
		},
		AggregateUserGrant: {"user.grant.added", "user.grant.removed", "user.grant.cascade.removed"},
		AggregateAction:    {"action.added", "action.removed"},
		AggregateTarget:    {"target.added", "target.removed"},
		AggregateExecution: {"execution.set", "execution.v2.set", "execution.removed"},
		AggregateSchema:    {"user_schema.created", "user_schema.deleted"},
	}
}

// templateTypes are v4's IdP template types, as they appear in event types.
var templateTypes = []string{
	"oauth", "oidc", "jwt", "azure", "github", "github_enterprise", "gitlab",
	"gitlab_self_hosted", "google", "ldap", "ldap.v2", "apple", "saml", "zitadel",
}

func idpEventTypes(templatePrefix, legacyPrefix string) []string {
	var types []string
	for _, t := range templateTypes {
		types = append(types, templatePrefix+"idp."+t+".added", templatePrefix+"idp."+t+".changed")
	}
	types = append(types,
		templatePrefix+"idp.oidc.migrated.azure", templatePrefix+"idp.oidc.migrated.google",
		templatePrefix+"idp.removed",
		legacyPrefix+"idp.config.added", legacyPrefix+"idp.config.changed",
		legacyPrefix+"idp.config.deactivated", legacyPrefix+"idp.config.reactivated",
		legacyPrefix+"idp.config.removed",
		legacyPrefix+"idp.oidc.config.added", legacyPrefix+"idp.oidc.config.changed",
		legacyPrefix+"idp.jwt.config.added", legacyPrefix+"idp.jwt.config.changed",
	)
	return types
}

func decode(e v4.Event, v any) error {
	if len(e.Payload) == 0 || string(e.Payload) == "null" {
		return nil
	}
	return json.Unmarshal(e.Payload, v)
}

// ---- instance --------------------------------------------------------------

type domainPolicy struct {
	UserLoginMustBeDomain *bool `json:"userLoginMustBeDomain"`
}

type loginPolicy struct {
	AllowUsernamePassword *bool `json:"allowUsernamePassword"`
	AllowRegister         *bool `json:"allowRegister"`
	AllowExternalIDP      *bool `json:"allowExternalIdp"`
	ForceMFA              *bool `json:"forceMFA"`
	ForceMFALocalOnly     *bool `json:"forceMFALocalOnly"`
	DisableLoginWithEmail *bool `json:"disableLoginWithEmail"`
	DisableLoginWithPhone *bool `json:"disableLoginWithPhone"`
	PasswordlessType      *int  `json:"passwordlessType"`
}

func (p loginPolicy) applyTo(policy *LoginPolicy) {
	set := func(dst *bool, src *bool) {
		if src != nil {
			*dst = *src
		}
	}
	set(&policy.AllowUsernamePassword, p.AllowUsernamePassword)
	set(&policy.AllowRegister, p.AllowRegister)
	set(&policy.AllowExternalIDP, p.AllowExternalIDP)
	set(&policy.ForceMFA, p.ForceMFA)
	set(&policy.ForceMFALocalOnly, p.ForceMFALocalOnly)
	set(&policy.DisableLoginWithEmail, p.DisableLoginWithEmail)
	set(&policy.DisableLoginWithPhone, p.DisableLoginWithPhone)
	if p.PasswordlessType != nil {
		policy.PasswordlessType = *p.PasswordlessType
	}
}

type nameEvent struct {
	Name string `json:"name"`
}

type domainEvent struct {
	Domain string `json:"domain"`
}

type idpProviderEvent struct {
	IDPConfigID string `json:"idpConfigId"`
}

func (d *Instance) apply(e v4.Event) error {
	switch e.Type {
	case "instance.added", "instance.changed":
		var p nameEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		if p.Name != "" {
			d.Name = p.Name
		}
		if e.Type == "instance.added" {
			d.Removed = false
		}
	case "instance.removed":
		d.Removed = true
	case "instance.default.org.set":
		var p struct {
			OrgID string `json:"orgId"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		d.DefaultOrgID = p.OrgID
	case "instance.iam.project.set":
		var p struct {
			ProjectID string `json:"iamProjectId"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		d.IAMProjectID = p.ProjectID
	case "instance.domain.added", "instance.domain.primary.set", "instance.domain.removed",
		"instance.trusted_domains.added", "instance.trusted_domains.removed":
		var p domainEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		switch e.Type {
		case "instance.domain.added":
			d.Domains = setKey(d.Domains, p.Domain, true)
		case "instance.domain.primary.set":
			d.PrimaryDomain = p.Domain
		case "instance.domain.removed":
			delete(d.Domains, p.Domain)
		case "instance.trusted_domains.added":
			d.TrustedDomains = setKey(d.TrustedDomains, p.Domain, true)
		case "instance.trusted_domains.removed":
			delete(d.TrustedDomains, p.Domain)
		}
	case "instance.policy.domain.added", "instance.policy.domain.changed":
		var p domainPolicy
		if err := decode(e, &p); err != nil {
			return err
		}
		if p.UserLoginMustBeDomain != nil {
			d.UserLoginMustBeDomain = *p.UserLoginMustBeDomain
		} else if e.Type == "instance.policy.domain.added" {
			d.UserLoginMustBeDomain = false
		}
	case "instance.policy.login.added", "instance.policy.login.changed":
		var p loginPolicy
		if err := decode(e, &p); err != nil {
			return err
		}
		if e.Type == "instance.policy.login.added" {
			d.LoginPolicy = LoginPolicy{}
		}
		p.applyTo(&d.LoginPolicy)
	case "instance.policy.login.idpprovider.added":
		var p idpProviderEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		if !slices.Contains(d.LoginIDPs, p.IDPConfigID) {
			d.LoginIDPs = append(d.LoginIDPs, p.IDPConfigID)
		}
	case "instance.policy.login.idpprovider.removed", "instance.policy.login.idpprovider.cascade.removed":
		var p idpProviderEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		d.LoginIDPs = slices.DeleteFunc(d.LoginIDPs, func(id string) bool { return id == p.IDPConfigID })
	default:
		return applyIDPEvent(&d.IDPs, "instance.", "iam.", e)
	}
	return nil
}

// ---- org -------------------------------------------------------------------

func (d *Org) apply(e v4.Event) error {
	switch e.Type {
	case "org.added":
		var p nameEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		d.Name = p.Name
		d.State = OrgActive
		d.CreatedAt = e.CreatedAt
	case "org.changed":
		var p nameEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		if p.Name != "" {
			d.Name = p.Name
		}
	case "org.deactivated":
		d.State = OrgInactive
	case "org.reactivated":
		d.State = OrgActive
	case "org.removed":
		d.State = OrgRemoved
	case "org.domain.added", "org.domain.verified", "org.domain.primary.set", "org.domain.removed":
		var p domainEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		switch e.Type {
		case "org.domain.added":
			d.Domains = setKey(d.Domains, p.Domain, false)
		case "org.domain.verified":
			d.Domains = setKey(d.Domains, p.Domain, true)
		case "org.domain.primary.set":
			d.PrimaryDomain = p.Domain
		case "org.domain.removed":
			delete(d.Domains, p.Domain)
		}
	case "org.policy.domain.added", "org.policy.domain.changed":
		var p domainPolicy
		if err := decode(e, &p); err != nil {
			return err
		}
		if p.UserLoginMustBeDomain != nil {
			d.UserLoginMustBeDomain = p.UserLoginMustBeDomain
		} else if e.Type == "org.policy.domain.added" {
			mustBeDomain := false
			d.UserLoginMustBeDomain = &mustBeDomain
		}
	case "org.policy.domain.removed":
		d.UserLoginMustBeDomain = nil
	case "org.policy.login.added", "org.policy.login.changed":
		d.HasLoginPolicy = true
	case "org.policy.login.removed":
		d.HasLoginPolicy = false
	case "org.policy.login.idpprovider.added":
		var p idpProviderEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		if !slices.Contains(d.LoginIDPs, p.IDPConfigID) {
			d.LoginIDPs = append(d.LoginIDPs, p.IDPConfigID)
		}
	case "org.policy.login.idpprovider.removed", "org.policy.login.idpprovider.cascade.removed":
		var p idpProviderEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		d.LoginIDPs = slices.DeleteFunc(d.LoginIDPs, func(id string) bool { return id == p.IDPConfigID })
	default:
		return applyIDPEvent(&d.IDPs, "org.", "org.", e)
	}
	return nil
}

// ---- IdPs ------------------------------------------------------------------

// templateEvent is the subset of v4's IdP template payloads the stage keeps.
// Azure and GitLab spell the client fields in snake case.
type templateEvent struct {
	ID                string          `json:"id"`
	Name              *string         `json:"name"`
	Issuer            *string         `json:"issuer"`
	ClientID          *string         `json:"clientId"`
	ClientSecret      *v4.CryptoValue `json:"clientSecret"`
	Scopes            []string        `json:"scopes"`
	IDTokenMapping    *bool           `json:"idTokenMapping"`
	UsePKCE           *bool           `json:"usePKCE"`
	IsCreationAllowed *bool           `json:"isCreationAllowed"`
	IsLinkingAllowed  *bool           `json:"isLinkingAllowed"`
	IsAutoCreation    *bool           `json:"isAutoCreation"`
	IsAutoUpdate      *bool           `json:"isAutoUpdate"`
	AutoLinkingOption *int            `json:"autoLinkingOption"`
}

// legacyEvent is the subset of v4's legacy idp config payloads.
type legacyEvent struct {
	IDPConfigID  string          `json:"idpConfigId"`
	Name         *string         `json:"name"`
	IDPType      *int            `json:"idpType"`
	AutoRegister *bool           `json:"autoRegister"`
	ClientID     *string         `json:"clientId"`
	ClientSecret *v4.CryptoValue `json:"clientSecret"`
	Issuer       *string         `json:"issuer"`
	Scopes       []string        `json:"scopes"`
}

func (p templateEvent) applyTo(idp *IDP, added bool) {
	if added {
		// An added event carries every field, so absent means empty.
		*idp = IDP{ID: idp.ID, Type: idp.Type}
	}
	if p.Name != nil {
		idp.Name = *p.Name
	}
	if p.Issuer != nil {
		idp.Issuer = *p.Issuer
	}
	if p.ClientID != nil {
		idp.ClientID = *p.ClientID
	}
	if p.ClientSecret != nil {
		idp.ClientSecret = p.ClientSecret
	}
	if p.Scopes != nil || added {
		idp.Scopes = p.Scopes
	}
	set := func(dst *bool, src *bool) {
		if src != nil {
			*dst = *src
		}
	}
	set(&idp.IDTokenMapping, p.IDTokenMapping)
	set(&idp.UsePKCE, p.UsePKCE)
	set(&idp.Options.IsCreationAllowed, p.IsCreationAllowed)
	set(&idp.Options.IsLinkingAllowed, p.IsLinkingAllowed)
	set(&idp.Options.IsAutoCreation, p.IsAutoCreation)
	set(&idp.Options.IsAutoUpdate, p.IsAutoUpdate)
	if p.AutoLinkingOption != nil {
		idp.Options.AutoLinkingOption = *p.AutoLinkingOption
	}
}

// applyIDPEvent folds an IdP event of an instance or org. Template events
// read "<prefix>idp.<type>.added"; legacy ones "<legacy>idp.config.added" and
// "<legacy>idp.oidc.config.added". Other events are ignored.
func applyIDPEvent(idps *map[string]*IDP, templatePrefix, legacyPrefix string, e v4.Event) error {
	if *idps == nil {
		*idps = map[string]*IDP{}
	}
	get := func(id string) *IDP {
		idp, ok := (*idps)[id]
		if !ok {
			idp = &IDP{ID: id}
			(*idps)[id] = idp
		}
		return idp
	}

	if rest, ok := strings.CutPrefix(e.Type, legacyPrefix+"idp."); ok && strings.Contains(rest, "config.") {
		var p legacyEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		idp := get(p.IDPConfigID)
		switch rest {
		case "config.added":
			// How v4's template projection reads a legacy config
			// (reduceOldConfigAdded): creation and linking allowed,
			// auto-creation from autoRegister, id token mapping, no PKCE.
			*idp = IDP{ID: p.IDPConfigID, Legacy: true, Type: legacyType(p.IDPType), IDTokenMapping: true}
			idp.Options.IsCreationAllowed = true
			idp.Options.IsLinkingAllowed = true
			if p.Name != nil {
				idp.Name = *p.Name
			}
			if p.AutoRegister != nil {
				idp.Options.IsAutoCreation = *p.AutoRegister
			}
		case "config.changed":
			if p.Name != nil {
				idp.Name = *p.Name
			}
			if p.AutoRegister != nil {
				idp.Options.IsAutoCreation = *p.AutoRegister
			}
		case "config.removed":
			idp.Removed = true
		case "config.deactivated", "config.reactivated":
			// v4's template projection ignores these, and so does its login.
		case "oidc.config.added", "oidc.config.changed":
			if p.ClientID != nil {
				idp.ClientID = *p.ClientID
			}
			if p.ClientSecret != nil {
				idp.ClientSecret = p.ClientSecret
			}
			if p.Issuer != nil {
				idp.Issuer = *p.Issuer
			}
			if p.Scopes != nil {
				idp.Scopes = p.Scopes
			}
		case "jwt.config.added", "jwt.config.changed":
			idp.Type = IDPJWT
		}
		return nil
	}

	rest, ok := strings.CutPrefix(e.Type, templatePrefix+"idp.")
	if !ok {
		return nil
	}
	var p templateEvent
	if err := decode(e, &p); err != nil {
		return err
	}
	switch {
	case rest == "removed":
		get(p.ID).Removed = true
	case rest == "oidc.migrated.google":
		idp := get(p.ID)
		idp.Type = IDPGoogle
		p.applyTo(idp, true)
	case rest == "oidc.migrated.azure":
		idp := get(p.ID)
		idp.Type = "azure"
		p.applyTo(idp, true)
	default:
		typ, added := strings.CutSuffix(rest, ".added")
		if !added {
			typ, _ = strings.CutSuffix(rest, ".changed")
		}
		typ = strings.TrimSuffix(typ, ".v2") // ldap.v2
		idp := get(p.ID)
		idp.Type = typ
		p.applyTo(idp, added)
	}
	return nil
}

func legacyType(idpType *int) string {
	if idpType == nil {
		return IDPOIDC
	}
	switch *idpType {
	case 1:
		return IDPSAML
	case 2:
		return IDPJWT
	}
	return IDPOIDC
}

// ---- user ------------------------------------------------------------------

type humanAdded struct {
	UserName          string          `json:"userName"`
	FirstName         string          `json:"firstName"`
	LastName          string          `json:"lastName"`
	NickName          string          `json:"nickName"`
	DisplayName       string          `json:"displayName"`
	PreferredLanguage string          `json:"preferredLanguage"`
	Gender            int             `json:"gender"`
	Email             string          `json:"email"`
	Phone             string          `json:"phone"`
	Country           string          `json:"country"`
	Locality          string          `json:"locality"`
	PostalCode        string          `json:"postalCode"`
	Region            string          `json:"region"`
	StreetAddress     string          `json:"streetAddress"`
	Secret            *v4.CryptoValue `json:"secret"`
	EncodedHash       string          `json:"encodedHash"`
	ChangeRequired    bool            `json:"changeRequired"`
}

type profileChanged struct {
	FirstName         string  `json:"firstName"`
	LastName          string  `json:"lastName"`
	NickName          *string `json:"nickName"`
	DisplayName       *string `json:"displayName"`
	PreferredLanguage *string `json:"preferredLanguage"`
	Gender            *int    `json:"gender"`
}

type passwordChanged struct {
	Secret         *v4.CryptoValue `json:"secret"`
	EncodedHash    string          `json:"encodedHash"`
	ChangeRequired bool            `json:"changeRequired"`
}

type linkEvent struct {
	IDPConfigID    string `json:"idpConfigId"`
	ExternalUserID string `json:"userId"`
	DisplayName    string `json:"displayName"`
	PreviousID     string `json:"previousId"`
	NewID          string `json:"newId"`
}

// passwordHash is v4's crypto.SecretOrEncodedHash: old events keep the bcrypt
// hash as the bytes of a legacy CryptoValue.
func passwordHash(secret *v4.CryptoValue, encoded string) string {
	if secret != nil && len(secret.Crypted) > 0 {
		return string(secret.Crypted)
	}
	return encoded
}

func (d *User) apply(e v4.Event) error {
	switch e.Type {
	case "user.human.added", "user.human.selfregistered", "user.added", "user.selfregistered":
		var p humanAdded
		if err := decode(e, &p); err != nil {
			return err
		}
		*d = User{
			OrgID:             e.Owner,
			State:             StateActive,
			Username:          p.UserName,
			CreatedAt:         e.CreatedAt,
			FirstName:         p.FirstName,
			LastName:          p.LastName,
			NickName:          p.NickName,
			DisplayName:       p.DisplayName,
			PreferredLanguage: p.PreferredLanguage,
			Gender:            p.Gender,
			Email:             p.Email,
			Phone:             p.Phone,
			PasswordHash:      passwordHash(p.Secret, p.EncodedHash),
			Address:           p.Country != "" || p.Locality != "" || p.PostalCode != "" || p.Region != "" || p.StreetAddress != "",
		}
		d.PasswordChangeRequired = p.ChangeRequired && d.PasswordHash != ""
	case "user.machine.added":
		var p struct {
			UserName string `json:"userName"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		*d = User{OrgID: e.Owner, Machine: true, State: StateActive, Username: p.UserName, CreatedAt: e.CreatedAt}
	case "user.human.initialization.code.added", "user.initialization.code.added":
		d.State = StateInitial
	case "user.human.initialization.check.succeeded", "user.initialization.check.succeeded":
		d.State = StateActive
	case "user.locked":
		d.State = StateLocked
	case "user.unlocked", "user.reactivated":
		d.State = StateActive
	case "user.deactivated":
		d.State = StateInactive
	case "user.removed":
		d.State = StateDeleted
	case "user.username.changed", "user.domain.claimed":
		var p struct {
			UserName string `json:"userName"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		d.Username = p.UserName
	case "user.human.profile.changed", "user.profile.changed":
		var p profileChanged
		if err := decode(e, &p); err != nil {
			return err
		}
		if p.FirstName != "" {
			d.FirstName = p.FirstName
		}
		if p.LastName != "" {
			d.LastName = p.LastName
		}
		if p.NickName != nil {
			d.NickName = *p.NickName
		}
		if p.DisplayName != nil {
			d.DisplayName = *p.DisplayName
		}
		if p.PreferredLanguage != nil {
			d.PreferredLanguage = *p.PreferredLanguage
		}
		if p.Gender != nil {
			d.Gender = *p.Gender
		}
	case "user.human.email.changed", "user.email.changed":
		var p struct {
			Email string `json:"email"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		d.Email = p.Email
		d.EmailVerified = false
	case "user.human.email.verified", "user.email.verified":
		d.EmailVerified = true
	case "user.human.phone.changed", "user.phone.changed":
		var p struct {
			Phone string `json:"phone"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		d.Phone = p.Phone
		d.PhoneVerified = false
	case "user.human.phone.verified", "user.phone.verified":
		d.PhoneVerified = true
	case "user.human.phone.removed", "user.phone.removed":
		d.Phone = ""
		d.PhoneVerified = false
		d.OTPSMS = false
	case "user.human.password.changed", "user.password.changed":
		var p passwordChanged
		if err := decode(e, &p); err != nil {
			return err
		}
		d.PasswordHash = passwordHash(p.Secret, p.EncodedHash)
		d.PasswordChangeRequired = p.ChangeRequired
	case "user.human.password.hash.updated":
		var p struct {
			EncodedHash string `json:"encodedHash"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		d.PasswordHash = p.EncodedHash
	case "user.human.address.changed", "user.address.changed":
		d.Address = true
	case "user.human.avatar.added":
		d.Avatar = true
	case "user.human.avatar.removed":
		d.Avatar = false
	case "user.human.externalidp.added", "user.human.externalidp.removed",
		"user.human.externalidp.cascade.removed", "user.human.externalidp.id.migrated":
		var p linkEvent
		if err := decode(e, &p); err != nil {
			return err
		}
		switch e.Type {
		case "user.human.externalidp.added":
			if d.Links == nil {
				d.Links = map[string]Link{}
			}
			d.Links[LinkKey(p.IDPConfigID, p.ExternalUserID)] = Link{IDPID: p.IDPConfigID, ExternalUserID: p.ExternalUserID, DisplayName: p.DisplayName}
		case "user.human.externalidp.id.migrated":
			if link, ok := d.Links[LinkKey(p.IDPConfigID, p.PreviousID)]; ok {
				delete(d.Links, LinkKey(p.IDPConfigID, p.PreviousID))
				link.ExternalUserID = p.NewID
				d.Links[LinkKey(p.IDPConfigID, p.NewID)] = link
			}
		default:
			delete(d.Links, LinkKey(p.IDPConfigID, p.ExternalUserID))
		}
	case "user.human.mfa.otp.added", "user.mfa.otp.added":
		// Not usable until verified.
	case "user.human.mfa.otp.verified", "user.mfa.otp.verified":
		d.TOTP = true
	case "user.human.mfa.otp.removed", "user.mfa.otp.removed":
		d.TOTP = false
	case "user.human.mfa.otp.sms.added":
		d.OTPSMS = true
	case "user.human.mfa.otp.sms.removed":
		d.OTPSMS = false
	case "user.human.mfa.otp.email.added":
		d.OTPEmail = true
	case "user.human.mfa.otp.email.removed":
		d.OTPEmail = false
	case "user.human.mfa.u2f.token.verified", "user.human.mfa.u2f.token.removed",
		"user.human.passwordless.token.verified", "user.human.passwordless.token.removed":
		var p struct {
			TokenID string `json:"webAuthNTokenId"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		tokens := &d.U2F
		if strings.Contains(e.Type, "passwordless") {
			tokens = &d.Passkeys
		}
		if strings.HasSuffix(e.Type, ".verified") {
			*tokens = setKey(*tokens, p.TokenID, true)
		} else {
			delete(*tokens, p.TokenID)
		}
	case "user.human.mfa.recoverycode.added":
		d.RecoveryCodes = true
	case "user.human.mfa.recoverycode.removed":
		d.RecoveryCodes = false
	case "user.metadata.set", "user.metadata.removed":
		var p struct {
			Key string `json:"key"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		if e.Type == "user.metadata.set" {
			d.MetadataKeys = setKey(d.MetadataKeys, p.Key, true)
		} else {
			delete(d.MetadataKeys, p.Key)
		}
	case "user.metadata.removed.all":
		d.MetadataKeys = nil
	case "user.machine.key.added", "user.machine.key.removed":
		var p struct {
			KeyID string `json:"keyId"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		if e.Type == "user.machine.key.added" {
			d.MachineKeys = setKey(d.MachineKeys, p.KeyID, true)
		} else {
			delete(d.MachineKeys, p.KeyID)
		}
	case "user.pat.added", "user.pat.removed":
		var p struct {
			TokenID string `json:"tokenId"`
		}
		if err := decode(e, &p); err != nil {
			return err
		}
		if e.Type == "user.pat.added" {
			d.PATs = setKey(d.PATs, p.TokenID, true)
		} else {
			delete(d.PATs, p.TokenID)
		}
	case "user.machine.secret.set":
		d.MachineSecret = true
	case "user.machine.secret.removed":
		d.MachineSecret = false
	}
	return nil
}

// ---- objects that are only counted -----------------------------------------

func (d *Object) apply(e v4.Event) error {
	var p struct {
		AppID   string `json:"appId"`
		Key     string `json:"key"`
		GrantID string `json:"grantId"`
	}
	if err := decode(e, &p); err != nil {
		return err
	}
	switch e.Type {
	case "project.added", "user.grant.added", "action.added", "target.added",
		"execution.set", "execution.v2.set", "user_schema.created":
		d.Live = true
	case "project.removed", "user.grant.removed", "user.grant.cascade.removed", "action.removed",
		"target.removed", "execution.removed", "user_schema.deleted":
		d.Live = false
	case "project.application.added":
		d.Apps = setKey(d.Apps, p.AppID, true)
	case "project.application.removed":
		delete(d.Apps, p.AppID)
	case "project.role.added":
		d.Roles = setKey(d.Roles, p.Key, true)
	case "project.role.removed":
		delete(d.Roles, p.Key)
	case "project.grant.added":
		d.Grants = setKey(d.Grants, p.GrantID, true)
	case "project.grant.removed", "project.grant.cascade.removed":
		delete(d.Grants, p.GrantID)
	}
	return nil
}

func setKey[V any](m map[string]V, key string, value V) map[string]V {
	if m == nil {
		m = map[string]V{}
	}
	m[key] = value
	return m
}
