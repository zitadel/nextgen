package httputil

import (
	"fmt"
	"net"
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
	// Canonicalize: surrounding whitespace (comma-separated env lists) and a
	// trailing dot ("name." and "name" are the same DNS name) must not turn
	// an entry into a rule that never matches (ADR 061 decision 4).
	entry = strings.TrimSuffix(strings.TrimSpace(entry), ".")
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
	// A hostname is matched against req.URL.Hostname(), which never carries
	// a scheme, port, userinfo, path, whitespace, or control characters. An
	// entry with any of those (e.g. "localhost:8080") would be a deny rule
	// that silently never fires, so it is a configuration error instead.
	// "*" also fails here: wildcard matching is unsupported, and accepting
	// "*.internal.example" as a literal name would be a rule that never
	// matches any subdomain.
	badRune := func(r rune) bool { return r <= ' ' || r == 0x7f }
	if strings.ContainsFunc(entry, badRune) || strings.ContainsAny(entry, ":@?#*") {
		return nil, fmt.Errorf("invalid hostname entry %q: use a bare hostname, IP, or CIDR", entry)
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

// CheckAddress applies the policy to a request's URL hostname before any
// connection is opened: hostname entries match by name, and a literal-IP
// host also matches IP and CIDR entries. Domains are deliberately not
// resolved here — the dial-time check in the transport owns resolved
// addresses, so a DNS answer cannot bypass anything by being checked twice.
// Consequence: a hostname allow entry only counters a hostname deny entry;
// a denial by IP range needs an IP or CIDR allow entry.
func (p *Policy) CheckAddress(hostname string) error {
	if !p.Enforces() {
		return nil
	}
	hostname = strings.TrimSuffix(hostname, ".")
	var ips []net.IP
	if ip := net.ParseIP(hostname); ip != nil {
		ips = []net.IP{ip}
	}
	return p.Check(ips, hostname)
}
