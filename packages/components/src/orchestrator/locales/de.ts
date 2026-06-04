/**
 * German locale dictionary.
 *
 * Structure mirrors {@link en} — same keys, translated values.
 * Copy aligned to Figma screens file `xkvBjkOJ8ENuHdTGZHXezK` (May 2026).
 */
import type { Locale } from "./en.js";

export const de: Locale = {
  // --- Anmelden (Figma 2xl `6593:141983`, card `6593:141985`, stack `6593:141989`) ---
  "identifier.title": "Anmelden",
  "identifier.field.email": "E-Mail",
  "identifier.field.email.placeholder": "du@unternehmen.com",
  "identifier.field.password": "Passwort",
  "identifier.action.continue": "Weiter",
  "identifier.action.passkey": "Mit Passkey anmelden",
  "identifier.action.register.lead": "Noch kein Konto? ",
  "identifier.action.register.link": "Registrieren",

  // --- Anmelden / Passwort-Schritt (gleicher Bildschirm; geteilter Flow Schritt 2) ---
  "password.title": "Anmelden",
  "password.field.password": "Passwort",
  "password.action.signin": "Anmelden",
  "password.action.passkey": "Mit Passkey anmelden",
  "password.action.register.lead": "Noch kein Konto? ",
  "password.action.register.link": "Registrieren",

  // --- Registrieren (2xl frame `6593:141741`, card `6593:141743`) ---
  "register.title": "Konto erstellen",
  "register.field.email": "E-Mail",
  "register.field.email.placeholder": "du@unternehmen.com",
  "register.field.password": "Passwort",
  "register.field.password.help":
    "Mindestens 8 Zeichen, einschließlich eines Sonderzeichens und einer Zahl.",
  "register.action.password": "Mit Passwort fortfahren",
  "register.action.passkey": "Mit Passkey registrieren",
  "register.action.submit": "Registrieren",
  "register.action.sign_in.lead": "Bereits ein Konto? ",
  "register.action.sign_in.link": "Anmelden",

  // --- Registrieren / Passwort-Schritt ---
  "register-password.title": "Konto erstellen",
  "register-password.description": "Wähle ein Passwort für dieses Konto.",
  "register-password.field.password": "Passwort",
  "register-password.field.password.help":
    "Mindestens 8 Zeichen, einschließlich eines Sonderzeichens und einer Zahl.",
  "register-password.action.submit": "Registrieren",

  // --- Passkey Upsell (`6594:630`) ---
  "passkey-upsell.title": "Nächstes Mal schneller anmelden",
  "passkey-upsell.description": "Richte einen Passkey ein, um dich schneller anzumelden.",
  "passkey-upsell.description.line1": "Kein Passwort mehr nötig.",
  "passkey-upsell.description.line2":
    "Melde dich mit Face ID, Touch ID oder PIN an.",
  "passkey-upsell.action.setup": "Passkey einrichten",
  "passkey-upsell.action.skip": "Vorerst überspringen",
  "error.passkey_cancelled": "Passkey-Einrichtung wurde abgebrochen",
  "error.passkey_not_registered":
    "Dieser Passkey ist nicht registriert. Bitte melde dich mit E-Mail und Passwort an.",
  "error.passkey_setup_failed":
    "Passkey-Registrierung wurde nicht abgeschlossen. Bitte versuche es erneut.",
  "error.passkey_unsupported":
    "Dieses Gerät unterstützt keine Passkeys",
  "error.passkey_failed": "Etwas ist schiefgelaufen. Bitte versuche es erneut.",

  // --- Angemeldet (`6596:132846`) ---
  "complete.title": "Du bist angemeldet als",
  "signed-in.continue": "Weiter",
  "signed-in.logout": "Abmelden",

  // --- Passwort-Wiederherstellung ---
  "recover.title": "E-Mail prüfen",
  "recover.description":
    "Wir haben einen Link zum Zurücksetzen des Passworts an deine E-Mail-Adresse gesendet.",
  "recover.action.back": "Zurück zur Anmeldung",

  // --- Passkey Login ---
  "passkey-login.title": "Mit Passkey anmelden",

  // --- Gemeinsame Aktionen ---
  "submit.continue": "Weiter",
  "submit.signin": "Anmelden",
  "action.forgot_password": "Passwort vergessen?",
  "action.cancel": "Abbrechen",

  // --- SSO ---
  "sso.redirect.title": "Weiterleitung zum Anbieter…",

  // --- Feld- / Formularfehler ---
  "error.email_required": "Bitte gib eine E-Mail-Adresse ein",
  "error.email_invalid": "Bitte gib eine gültige E-Mail-Adresse ein",
  "error.password_required": "Bitte gib ein Passwort ein",
  "error.password_incorrect": "Falsche E-Mail oder falsches Passwort.",
  "error.email_exists": "Ein Konto mit dieser E-Mail-Adresse existiert bereits.",
  "error.invalid_credentials": "Falsche E-Mail oder falsches Passwort.",
  "error.required": "Dieses Feld ist erforderlich.",

  // --- Formular-Alerts ---
  "error.sign_in_server.title": "Anmeldung konnte nicht abgeschlossen werden.",
  "error.sign_in_server.body": "Bitte versuche es in einigen Minuten erneut",
};
