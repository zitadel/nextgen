const fs = require('fs');

const files = [
  'docs/adrs/014-captcha-gate-contract.md',
  'docs/design/branding/validator.md',
  'docs/design/branding/templates.md',
  'docs/design/branding/README.md',
  'docs/design/branding/form-participation.md',
  'docs/design/branding/schema.md',
  'packages/components/src/orchestrator/index.ts',
  'packages/components/src/orchestrator/liquid.spec.ts',
  'packages/components/src/atoms/zl-error.ts',
  'packages/components/src/orchestrator/liquid.ts',
  'packages/components/src/orchestrator/fallback-ui.ts',
  'packages/components/src/orchestrator/fallback-ui.spec.ts',
  'packages/components/src/orchestrator/templates/auth-form.liquid.ts',
  'packages/components/src/orchestrator/zitadel-login.ts'
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`Skipping ${file}`);
    continue;
  }
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/patchMandatoryGates/g, 'patchFallbackUi');
  content = content.replace(/mandatoryGatesMarkerComment/g, 'fallbackUiMarkerComment');
  content = content.replace(/mandatoryGates/g, 'fallbackUi');
  content = content.replace(/MANDATORY_GATES/g, 'FALLBACK_UI');
  content = content.replace(/mandatory_gates/g, 'fallback_ui');
  content = content.replace(/mandatory-gates/g, 'fallback-ui');
  fs.writeFileSync(file, content);
  console.log(`Updated ${file}`);
}
