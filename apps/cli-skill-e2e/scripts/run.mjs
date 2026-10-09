// Runs the journey eval: one clean container per config, the skill installed
// globally (-g) so /work stays empty for stage 1 to scaffold into, then each
// stage's prompt is driven through `claude -p`. Reuses existing results unless
// FRESH=1. Docker + a Claude credential required.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cfg = JSON.parse(readFileSync(join(root, "journey.config.json"), "utf8"));

const OUT = process.env.OUT || join(root, "out");
const REPO = process.env.REPO || "zitadel/nextgen";
// Default to the published default branch; override with BRANCH=<name> to
// validate a skill change pre-merge (e.g. this feature branch).
const BRANCH = process.env.BRANCH || "main";
// Driver models to compare (the agent doing the work). A comma list makes a
// matrix: every (config, model) cell runs REPEATS times so we get a success
// *rate* and can compare models (e.g. MODELS=haiku,sonnet).
const MODELS = (process.env.MODELS || process.env.MODEL || "sonnet")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REPEATS = Math.max(1, Number(process.env.REPEATS || "1"));
const SIM_MODEL = process.env.SIM_MODEL || "haiku";
const IMAGE = process.env.IMAGE || "node:24";
const MAX_TURNS = process.env.MAX_TURNS || "40";
// The baseline (no skill) can't find the CLI; without a tight cap it burns the
// full turn budget flailing on every stage. A small cap means "if it can't get
// going in a few turns, that stage is a failure" — and the driver then aborts
// the rest of the stateful journey (nothing for later stages to act on).
const BASELINE_MAX_TURNS = process.env.BASELINE_MAX_TURNS || "5";
const MAX_QA = process.env.MAX_QA || "6";
const ENV_FILE = process.env.ENV_FILE || "";
const FRESH = process.env.FRESH === "1";

const hasCred = Boolean(
  ENV_FILE || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN,
);

// Each stage is driven as a multi-turn conversation by /harness/scripts/drive.mjs
// (mounted read-only). "Non-interactive" applies to how the agent drives the
// CLI, not to the agent↔user conversation, so the driver lets the agent prompt
// and a simulated user answers. The driver reads /harness/journey.config.json
// and writes /out/stage<N>.jsonl + /out/after-stage<N>.json.
const CONTAINER = `set -e
mkdir -p /work && cd /work
__INSTALL__
( ls -R /root/.claude/skills 2>/dev/null || echo "no global skills" ) > /out/skills-present.txt
TOK="\${ANTHROPIC_API_KEY:-}"; case "$TOK" in sk-ant-oat*) export CLAUDE_CODE_OAUTH_TOKEN="$TOK"; unset ANTHROPIC_API_KEY ;; esac
npm i -g @anthropic-ai/claude-code@latest >/out/claude-install.log 2>&1 || true
node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs" >>/out/claude-install.log 2>&1 || true
node /harness/scripts/drive.mjs
mkdir -p /out/artifacts && cp -r .zitadel /out/artifacts/ 2>/dev/null || true
cp zitadel.json .env .env.local /out/artifacts/ 2>/dev/null || true`;

// One (config, model, repeat) cell → one container. Results live under
// out/<config>/<model>/r<k>/ so the report can group repeats and compare models.
function runCell(config, model, rep) {
  const dir = join(OUT, config, model, `r${rep}`);
  const label = `${config}/${model}/r${rep}`;
  if (!FRESH && existsSync(join(dir, "stage1.jsonl"))) {
    console.log(`>> ${label}: reusing existing results (set FRESH=1 to re-run)`);
    return;
  }
  if (!hasCred) {
    console.error(
      `No credential to run '${label}'. Set ENV_FILE=<file with ANTHROPIC_API_KEY=…>, ` +
        "or ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN (mint one with `claude setup-token`). " +
        "To just regrade existing results, leave FRESH unset.",
    );
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(`>> ${label}: running…`);

  const install =
    config === "with-skill"
      ? // `--full-depth` is required: the repo now ships a shallow root skill
        // (`skills/zitadel`, the router) as well as the deeper `zitadel-cli`
        // (`apps/cli/skills/zitadel-cli`). Without it, `skills add` stops at the
        // shallowest skill it finds and never discovers `zitadel-cli`.
        `npx -y skills@latest add '${REPO}#${BRANCH}' --full-depth --skill zitadel-cli --agent claude-code -g -y --copy >/out/skill-install.log 2>&1`
      : `echo 'baseline: no skill'`;

  const args = ["run", "--rm"];
  if (ENV_FILE) args.push("--env-file", ENV_FILE);
  else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) args.push("-e", "CLAUDE_CODE_OAUTH_TOKEN");
  else args.push("-e", "ANTHROPIC_API_KEY");
  args.push("-e", `MODEL=${model}`, "-e", `SIM_MODEL=${SIM_MODEL}`, "-e", `MAX_TURNS=${MAX_TURNS}`);
  args.push("-e", `BASELINE_MAX_TURNS=${BASELINE_MAX_TURNS}`, "-e", `CONFIG=${config}`);
  if (process.env.CALL_TIMEOUT_MS) args.push("-e", `CALL_TIMEOUT_MS=${process.env.CALL_TIMEOUT_MS}`);
  args.push("-e", `MAX_QA=${MAX_QA}`, "-e", "OUT=/out", "-e", "WORK=/work", "-e", "IS_SANDBOX=1");
  args.push("-e", "ZITADEL_TELEMETRY=0", "-e", "DO_NOT_TRACK=1", "-e", "DISABLE_TELEMETRY=1");
  args.push("-e", "DISABLE_AUTOUPDATER=1", "-e", "DISABLE_ERROR_REPORTING=1");
  args.push("-v", `${dir}:/out`);
  args.push("-v", `${root}/scripts:/harness/scripts:ro`);
  args.push("-v", `${root}/journey.config.json:/harness/journey.config.json:ro`);
  args.push(IMAGE, "bash", "-lc", CONTAINER.replace("__INSTALL__", install));

  const r = spawnSync("docker", args, { stdio: "inherit" });
  if (r.status !== 0) console.error(`!! ${label} docker exited ${r.status}`);
}

mkdirSync(OUT, { recursive: true });
console.log(`matrix: models [${MODELS.join(", ")}] × ${REPEATS} repeat(s) × configs [${cfg.configs.join(", ")}]`);
for (const model of MODELS) {
  for (const config of cfg.configs) {
    // The baseline fails fast and deterministically (it never finds the CLI),
    // so one repeat is enough; only the with-skill runs need repeating for a rate.
    const reps = config === "baseline" ? 1 : REPEATS;
    for (let k = 1; k <= reps; k += 1) runCell(config, model, k);
  }
}
console.log("done. results in", OUT);
