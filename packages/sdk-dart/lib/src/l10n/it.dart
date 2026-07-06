/// Italian locale dictionary.
///
/// Hand-ported from `packages/components/src/orchestrator/locales/it.ts` —
/// keep the two in sync when copy changes.
const Map<String, String> it = {
  // Step: identifier (inserimento e-mail — prima schermata)
  'identifier.title': 'Accedi',
  'identifier.description': 'Inserisci la tua e-mail per continuare',
  'identifier.field.email': 'E-mail aziendale',
  'identifier.field.email.placeholder': 'tu@azienda.com',
  'identifier.field.password': 'Password',
  'identifier.action.submit': 'Accedi',
  'identifier.action.continue': 'Accedi',
  'identifier.action.passkey': 'Accedi con passkey',
  'identifier.action.register.lead': 'Non hai un account? ',
  'identifier.action.register.link': 'Registrati',

  // Step: authenticate (inserimento password — flusso di accesso)
  'authenticate.title': 'Accedi',
  'authenticate.description': 'Inserisci la tua password',
  'authenticate.field.password': 'Password',
  'authenticate.action.submit': 'Accedi',

  // Step: choose-register (scelta del percorso di registrazione)
  'choose-register.title': 'Crea il tuo account',
  'choose-register.description': 'Scegli come registrarti',
  'choose-register.action.register-with-password': 'Registrati con password',
  'choose-register.action.register-with-passkey': 'Registrati con passkey',

  // Step: collect-credentials (e-mail + password)
  'collect-credentials.title': 'Crea il tuo account',
  'collect-credentials.description': 'Configura e-mail e password',
  'collect-credentials.field.email': 'E-mail aziendale',
  'collect-credentials.field.email.placeholder': 'tu@azienda.com',
  'collect-credentials.field.password': 'Password',
  'collect-credentials.action.submit': 'Registrati',

  // Step: register-password (inserimento password — registrazione)
  'register-password.title': 'Crea la tua password',
  'register-password.description':
      'Scegli una password sicura per il tuo account',
  'register-password.field.password': 'Password',
  'register-password.action.submit': 'Registrati',

  // Step: passkey-upsell (proposta passkey — dopo la registrazione)
  'passkey-upsell.title': 'Accedi più velocemente la prossima volta',
  'passkey-upsell.description': 'Nessuna password necessaria.',
  'passkey-upsell.description.line1': 'Nessuna password necessaria.',
  'passkey-upsell.description.line2': 'Accedi con Face ID, Touch ID o PIN.',
  'passkey-upsell.action.passkey_register': 'Configura passkey',
  'passkey-upsell.action.skip': 'Salta per ora',
  'passkey-upsell.action.setup': 'Configura passkey',

  // Step: collect-passkey-email (solo e-mail — registrazione solo passkey)
  'collect-passkey-email.title': 'Crea il tuo account',
  'collect-passkey-email.description':
      'Inserisci la tua e-mail per configurare una passkey',
  'collect-passkey-email.field.email': 'E-mail aziendale',
  'collect-passkey-email.field.email.placeholder': 'tu@azienda.com',
  'collect-passkey-email.action.submit': 'Continua',

  // Step: passkey-enroll (cerimonia passkey — percorso solo passkey)
  'passkey-enroll.title': 'Configura la tua passkey',
  'passkey-enroll.description':
      'Usa Face ID, Touch ID o il PIN del dispositivo per creare una passkey.',
  'passkey-enroll.action.passkey_register': 'Configura passkey',

  // Step: done (terminale — conferma accesso)
  'done.title': 'Sei connesso come',
  'done.description': '',

  // --- Alias dei nomi step per il flusso login predefinito ---
  'password.title': 'Accedi',
  'password.description': 'Inserisci la tua password',
  'password.field.password': 'Password',
  'password.action.signin': 'Accedi',
  'password.action.passkey': 'Accedi con passkey',
  'password.action.register.lead': 'Non hai un account? ',
  'password.action.register.link': 'Registrati',

  'register.title': 'Crea il tuo account',
  'register.description': '',
  'register.field.email': 'E-mail aziendale',
  'register.field.email.placeholder': 'tu@azienda.com',
  'register.field.password': 'Password',
  'register.field.givenName': 'Nome',
  'register.field.familyName': 'Cognome',
  'register.field.dateOfBirth': 'Data di nascita',
  'register.field.country': 'Paese',
  'register.field.country.placeholder': 'Seleziona il tuo paese',
  'register.field.terms': 'Accetto i termini di servizio',
  'register.action.password': 'Continua con password',
  'register.action.passkey': 'Continua con passkey',
  'register.action.submit': 'Registrati',
  'register.action.sign_in.lead': 'Hai già un account? ',
  'register.action.sign_in.link': 'Accedi',

  'complete.title': 'Sei connesso come',
  'signed-in.continue': 'Continua',
  'signed-in.logout': 'Esci',

  // --- Accesso con passkey ---
  'passkey-login.title': 'Accedi con la tua passkey',

  // --- Recupero password ---
  'recover.title': 'Controlla la tua e-mail',
  'recover.description':
      'Abbiamo inviato un link per reimpostare la password al tuo indirizzo e-mail.',
  'recover.action.back': "Torna all'accesso",

  // --- Azioni condivise ---
  'submit.continue': 'Continua',
  'submit.signin': 'Accedi',
  'action.forgot_password': 'Password dimenticata?',
  'action.cancel': 'Annulla',

  // --- SSO ---
  'sso.redirect.title': 'Reindirizzamento al provider…',

  // --- Errori passkey ---
  'error.passkey_cancelled':
      'La configurazione della passkey è stata annullata',
  'error.passkey_not_registered':
      'Questa passkey non è registrata. Accedi con e-mail e password.',
  'error.passkey_setup_failed':
      'La registrazione della passkey non è stata completata. Riprova.',
  'error.passkey_unsupported': 'Questo dispositivo non supporta le passkey',
  'error.passkey_failed': 'Qualcosa è andato storto. Riprova.',

  // --- Errori campo / modulo ---
  'error.email_required': 'Inserisci un indirizzo e-mail',
  'error.email_invalid': 'Inserisci un indirizzo e-mail valido',
  'error.password_required': 'Inserisci una password',
  'error.password_incorrect': 'E-mail o password errata.',
  'error.email_exists': 'Esiste già un account con questo indirizzo e-mail.',
  'error.invalid_credentials': 'E-mail o password errata.',
  'error.required': 'Questo campo è obbligatorio.',

  // --- Alert a livello di modulo ---
  'error.sign_in_server.title': "Non è stato possibile completare l'accesso.",
  'error.sign_in_server.body': 'Riprova tra qualche minuto',
};
