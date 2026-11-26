# Agent Instructions — `packages/sdk-angular`

- **Signal `input()` and `output()` only.** The components declare every input with `input()` and
  every event with `output()`, never `@Input()` or `@Output()`, so templates read `project()` and
  consumers bind them unchanged. Do not add `ngOnChanges`; read the signals in the template.
- **The Props types equal the inputs.** `ZitadelLoginProps`, `ZitadelLogoutProps` and
  `ZitadelSessionProps` in `src/lib/types.ts` are the shared config types of `sdk-core`, and
  `src/lib/types.spec.ts` fails when a component's inputs and those keys differ; change both.
- **Minimum Angular is 19**, the first release where signal inputs and `output()` are stable. Keep
  the peer ranges, the README, the cover page, the skill and the CLI's Angular floor in step.
