import type { Property } from "../property";

/**
 * ISO 3166-1 alpha-2 country for an IANA timezone, defaulting to the machine's
 * own zone. A curated subset of common zones — any zone not listed (or an
 * unknown/unavailable one) yields `undefined`, since we report no country
 * rather than guess. Derived from the timezone, never the IP, so no city or
 * region is ever inferred. The machine's own zone is resolved once and cached:
 * `Intl.DateTimeFormat` construction loads ICU data and is process-stable.
 */
class Country implements Property<string | undefined, string | undefined> {
  private readonly byTimezone: Record<string, string> = {
    "Africa/Abidjan": "CI",
    "Africa/Accra": "GH",
    "Africa/Addis_Ababa": "ET",
    "Africa/Algiers": "DZ",
    "Africa/Cairo": "EG",
    "Africa/Casablanca": "MA",
    "Africa/Johannesburg": "ZA",
    "Africa/Lagos": "NG",
    "Africa/Nairobi": "KE",
    "Africa/Tunis": "TN",
    "America/Anchorage": "US",
    "America/Argentina/Buenos_Aires": "AR",
    "America/Bogota": "CO",
    "America/Chicago": "US",
    "America/Denver": "US",
    "America/Halifax": "CA",
    "America/Lima": "PE",
    "America/Los_Angeles": "US",
    "America/Mexico_City": "MX",
    "America/New_York": "US",
    "America/Phoenix": "US",
    "America/Santiago": "CL",
    "America/Sao_Paulo": "BR",
    "America/Toronto": "CA",
    "America/Vancouver": "CA",
    "Asia/Bangkok": "TH",
    "Asia/Dhaka": "BD",
    "Asia/Dubai": "AE",
    "Asia/Hong_Kong": "HK",
    "Asia/Jakarta": "ID",
    "Asia/Jerusalem": "IL",
    "Asia/Karachi": "PK",
    "Asia/Kolkata": "IN",
    "Asia/Kuala_Lumpur": "MY",
    "Asia/Manila": "PH",
    "Asia/Riyadh": "SA",
    "Asia/Seoul": "KR",
    "Asia/Shanghai": "CN",
    "Asia/Singapore": "SG",
    "Asia/Taipei": "TW",
    "Asia/Tehran": "IR",
    "Asia/Tokyo": "JP",
    "Australia/Adelaide": "AU",
    "Australia/Brisbane": "AU",
    "Australia/Melbourne": "AU",
    "Australia/Perth": "AU",
    "Australia/Sydney": "AU",
    "Europe/Amsterdam": "NL",
    "Europe/Athens": "GR",
    "Europe/Berlin": "DE",
    "Europe/Brussels": "BE",
    "Europe/Bucharest": "RO",
    "Europe/Budapest": "HU",
    "Europe/Copenhagen": "DK",
    "Europe/Dublin": "IE",
    "Europe/Helsinki": "FI",
    "Europe/Istanbul": "TR",
    "Europe/Kyiv": "UA",
    "Europe/Lisbon": "PT",
    "Europe/London": "GB",
    "Europe/Madrid": "ES",
    "Europe/Moscow": "RU",
    "Europe/Oslo": "NO",
    "Europe/Paris": "FR",
    "Europe/Prague": "CZ",
    "Europe/Rome": "IT",
    "Europe/Stockholm": "SE",
    "Europe/Vienna": "AT",
    "Europe/Warsaw": "PL",
    "Europe/Zurich": "CH",
    "Pacific/Auckland": "NZ",
    "Pacific/Honolulu": "US",
  };

  private machineZone: string | undefined;
  private machineZoneResolved = false;

  public value(timezone: string | undefined): string | undefined {
    const zone = timezone ?? this.resolveMachineZone();
    return zone ? this.byTimezone[zone] : undefined;
  }

  private resolveMachineZone(): string | undefined {
    if (!this.machineZoneResolved) {
      this.machineZoneResolved = true;
      try {
        this.machineZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        this.machineZone = undefined;
      }
    }
    return this.machineZone;
  }
}

export const country = new Country();
