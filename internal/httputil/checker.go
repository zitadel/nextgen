package httputil

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// AddressDeniedError reports that an egress target was blocked by the deny
// list, naming the entry that matched so the failure is attributable in logs
// and to the caller who chose the URL.
type AddressDeniedError struct {
	deniedBy string
}

func NewAddressDeniedError(deniedBy string) *AddressDeniedError {
	return &AddressDeniedError{deniedBy: deniedBy}
}

func (e *AddressDeniedError) Error() string {
	return fmt.Sprintf("address is denied by '%s'", e.deniedBy)
}

func (e *AddressDeniedError) Is(target error) bool {
	var addressDeniedErr *AddressDeniedError
	if !errors.As(target, &addressDeniedErr) {
		return false
	}
	return e.deniedBy == addressDeniedErr.deniedBy
}

// HostChecker matches one policy entry: a CIDR network, a single IP, or a
// hostname (exact, case-insensitive — no wildcards or subdomain matching).
type HostChecker struct {
	Net    *net.IPNet
	IP     net.IP
	Domain string
}

// NewHostChecker classifies entry by parse: CIDR, then IP, then hostname.
// An empty entry returns nil. An entry containing "/" that is not a valid
// CIDR is an error rather than a hostname: hostnames cannot contain "/", and
// the silent alternative would be a deny rule that never matches.
func NewHostChecker(entry string) (*HostChecker, error) {
	if entry == "" {
		return nil, nil
	}
	if _, network, err := net.ParseCIDR(entry); err == nil {
		return &HostChecker{Net: network}, nil
	}
	if strings.Contains(entry, "/") {
		return nil, fmt.Errorf("invalid CIDR entry %q", entry)
	}
	if ip := net.ParseIP(entry); ip != nil {
		return &HostChecker{IP: ip}, nil
	}
	return &HostChecker{Domain: entry}, nil
}

// Matches reports whether the address string or one of the candidate IPs
// matches this entry, returning the matching rule for attribution.
func (c *HostChecker) Matches(ips []net.IP, address string) (rule string, ok bool) {
	if c.Domain != "" && strings.EqualFold(c.Domain, address) {
		return c.Domain, true
	}
	for _, ip := range ips {
		if c.Net != nil && c.Net.Contains(ip) {
			return c.Net.String(), true
		}
		if c.IP != nil && c.IP.Equal(ip) {
			return c.IP.String(), true
		}
	}
	return "", false
}

// IPLookupFunc resolves a hostname to its IP addresses. Injectable for tests;
// nil means [net.LookupIP].
type IPLookupFunc func(string) ([]net.IP, error)

// Policy is the egress decision for one client: a target is allowed when it
// matches the allow list, denied when it matches the deny list, and allowed
// otherwise. The allow list is an exception list carved out of the deny list,
// not a lockdown mode.
type Policy struct {
	deny  []*HostChecker
	allow []*HostChecker
}

// NewPolicy parses both lists, failing fast on malformed entries so a typo'd
// CIDR cannot silently weaken the deny list.
func NewPolicy(denyList, allowList []string) (*Policy, error) {
	parse := func(entries []string) ([]*HostChecker, error) {
		checkers := make([]*HostChecker, 0, len(entries))
		for _, entry := range entries {
			checker, err := NewHostChecker(entry)
			if err != nil {
				return nil, err
			}
			if checker != nil {
				checkers = append(checkers, checker)
			}
		}
		return checkers, nil
	}
	deny, err := parse(denyList)
	if err != nil {
		return nil, fmt.Errorf("deny list: %w", err)
	}
	allow, err := parse(allowList)
	if err != nil {
		return nil, fmt.Errorf("allow list: %w", err)
	}
	return &Policy{deny: deny, allow: allow}, nil
}

// Enforces reports whether the policy denies anything at all. With an empty
// deny list the allow list has nothing to override and every target passes.
func (p *Policy) Enforces() bool {
	return p != nil && len(p.deny) > 0
}

// Check applies allow-then-deny to the candidate IPs and address string.
// At dial time ips holds exactly the IP about to be connected, so an allow
// entry never lets a sibling DNS answer through: each dial is checked alone.
func (p *Policy) Check(ips []net.IP, address string) error {
	if !p.Enforces() {
		return nil
	}
	for _, allowed := range p.allow {
		if _, ok := allowed.Matches(ips, address); ok {
			return nil
		}
	}
	for _, denied := range p.deny {
		if rule, ok := denied.Matches(ips, address); ok {
			return NewAddressDeniedError(rule)
		}
	}
	return nil
}

// CheckURL resolves the URL's hostname and applies Check. A lookup failure
// fails closed. This URL-layer check exists to fail fast (and to match
// hostname entries before any connection); the dial-time check in the
// transport remains authoritative.
func (p *Policy) CheckURL(u *url.URL, lookup IPLookupFunc) error {
	if !p.Enforces() {
		return nil
	}
	hostname := u.Hostname()
	ips, err := hostnameToIPs(hostname, lookup)
	if err != nil {
		return err
	}
	return p.Check(ips, hostname)
}

// hostnameToIPs returns the literal IP when hostname parses as one, and the
// resolved addresses otherwise.
func hostnameToIPs(hostname string, lookup IPLookupFunc) ([]net.IP, error) {
	if ip := net.ParseIP(hostname); ip != nil {
		return []net.IP{ip}, nil
	}
	if lookup == nil {
		lookup = net.LookupIP
	}
	ips, err := lookup(hostname)
	if err != nil {
		return nil, fmt.Errorf("hostname lookup for egress check failed: %w", err)
	}
	return ips, nil
}
