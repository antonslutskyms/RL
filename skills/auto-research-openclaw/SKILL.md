---
name: auto-research-openclaw
description: "Autonomous NeMo-RL research on a local OpenClaw host: directed hypothesis testing and open-ended discovery with git and TSV logs as the ledger. Runs experiments locally via uv in the NeMo-RL checkout (no Brev, no Kubernetes, no Slurm unless the user explicitly redirects). Use for auto research, recipe tuning, and long local GPU campaigns driven from OpenClaw."
metadata: {"openclaw":{"emoji":"🔬","requires":{"bins":["uv","git"]}}}
---

# Auto Research (OpenClaw)

Run iterative NeMo-RL experiments in the **NeMo-RL repository checkout** on the **local OpenClaw machine** against the user's stated objective (accuracy, reward, throughput, latency, stability, or another recipe-specific metric). Use **git branches** and an **untracked TSV ledger** as the research journal.

This skill inherits the experiment loop, branching rules, stop conditions, and hypothesis priorities from `auto-research`, but **defaults to local execution only**. Do not use `brev-etiquette`, `launch-nemo-rl`, or remote schedulers unless the user explicitly asks to move off the OpenClaw host.

Treat dependencies as ready. Use the recipe's authoritative metric as the source of truth. Keep changes small, reproducible, and simple. Preserve unrelated user work.

## OpenClaw setup

1. **Repository root** — Run all commands from the NeMo-RL clone (the workspace or cwd the user attached). Confirm with `git rev-parse --show-toplevel` before branching.
2. **Skills** — Load this skill from the repo (`skills/auto-research-openclaw/`) via `skills.load.extraDirs`, copy into `<workspace>/skills/`, or symlink. After adding or editing the skill, start a new OpenClaw session (`/new`) or restart the gateway so it appears in `openclaw skills list`.
3. **Companion skill** — Use `session-memory` for every campaign (same checkpoints as `auto-research`).
4. **Execution** — Launch training with `exec` / bash on the **host** (not a sandbox) when GPUs are on the same machine as OpenClaw. For runs longer than one turn, use background mode and poll logs under `reports/auto_research/`.
5. **Secrets** — Load API keys from the user's shell environment or repo-local `.env` if present. Never print, log, or commit secret values. Do not assume Brev paths (`/home/ubuntu/RL`, `/ephemeral`).

See `{baseDir}/references/openclaw-environment.md` for paths, caches, long-running jobs, and progress reporting.

## Workflow

1. Inspect git state and identify unrelated user changes before branching.
2. Use a shared branch prefix. Prefer a user-provided one; otherwise default to `autoresearch/<date>-<recipe-slug>` (e.g. `autoresearch/2026-05-20-dapo-qwen2p5`).
3. Read the target recipe, its parents, and relevant code in `examples/run_grpo.py`, `nemo_rl/models/`, `nemo_rl/algorithms/`, `nemo_rl/environments/`, and `docs/`. For NeMo-gym recipes, also inspect `examples/nemo_gym/`.
4. Translate user stop rules into monitorable values: `target_experiment_count`, `campaign_deadline`, `per_experiment_timeout`, `target_metric`.
5. Verify data, checkpoints, runtime inputs, and that **local GPUs** are visible (`nvidia-smi` when applicable).
6. Create an untracked TSV log and per-experiment log directory under `reports/auto_research/`.
7. Run a baseline first on `<prefix>/baseline` if none exists.

**Runtime choice (OpenClaw default):** Run **locally** with `uv run` when the host has suitable GPUs. Use CPU-only local runs for light inspection, dry runs, and short non-GPU checks. If the user asks for Kubernetes or Slurm, stop and load `launch-nemo-rl` or the environment's native launcher instead of improvising cluster commands.

Use `session-memory` before branching; checkpoint after forming the plan, before and after meaningful edits or long-running launches, on direction changes, and before handoff or final summary.

After context compaction, handoff, disconnect, or a long gap, reload this skill and `session-memory`, read the latest handoff, and restate objective, stop rules, current branch, and latest result. Treat follow-up steering as additive unless the user explicitly changes the main objective.

## Branching

- One branch per experiment under the shared prefix; keep every branch (`keep`, `discard`, or `crash`).
- At least one hypothesis-focused commit per branch; follow-up fix commits on the same branch when rerunning is justified.
- Never stash, reset, or overwrite unrelated user changes silently. Use a separate `git worktree` or ask when dirty files overlap the experiment.

See `{baseDir}/references/git-workflow.md`.

## Loop

1. Pick one concrete hypothesis.
2. Create a branch such as `autoresearch/2026-05-20-dapo-qwen2p5/prompt-compact-schema`.
3. Edit the smallest set of files needed.
4. Commit the hypothesis.
5. Before launch, check monitored stop conditions.
6. Run locally with a unique log path:

```bash
LOG_DIR=reports/auto_research/<campaign>/<experiment>
mkdir -p "$LOG_DIR"
uv run <entrypoint> > "$LOG_DIR/run.log" 2>&1
```

For long GPU jobs from OpenClaw, run the same command in **background** and poll `$LOG_DIR/run.log` instead of blocking the chat turn until training finishes.

7. Enforce per-experiment wall-clock limits when requested (recipe timeout or external `timeout`; honor the tighter limit).
8. Extract the primary metric from the actual log format. If extraction is empty, inspect tail lines and the recipe logging path before marking the run.
9. Append a TSV row (schema in `{baseDir}/references/experiment-log-template.md`). Set `launcher` to `local` and `job_id` to `none` unless the user moved the run off-host.
10. Post user-facing progress: current branch, latest metric, attempted count, remaining count/time, stop-condition status.
11. After each experiment, state stop condition explicitly (met or not).
12. Mark `keep`, `discard`, or `crash`, then continue unless a stop condition is met.

Count-based stops count **attempted** experiments, not only successes. Campaign deadlines are absolute from campaign start. Per-run overruns are failures.

## Priorities

Same as `auto-research` — prefer high expected gain and low complexity:

- correctness and backend compatibility
- prompt and rollout formatting
- batch, sequence, and precision layout
- optimizer and scheduler tuning
- reward shaping, clipping, or scaling
- dataset mix or validation changes
- synchronous versus asynchronous execution based on **local** GPU count

See `{baseDir}/references/exploration-ideas.md` for symptom → hypothesis mapping.

## Avoid

- Do not route through Brev, `brev-etiquette`, or `/ephemeral` layout unless the user explicitly moves to Brev (then use `auto-research` + `brev-etiquette` instead).
- Do not default to `launch-nemo-rl`, Slurm batch queues, or remote clusters on OpenClaw.
- Do not mark a training hypothesis `discard` from an underpowered smoke run.
- Do not let compaction or follow-up questions erase the campaign goal — refresh `session-memory` first.

## Stop

Explicit user stop conditions override the generic rule. Do not stop because the search "feels done."

If the user gives no stopping conditions, run baseline plus up to three low-risk experiments, summarize the best result, and ask before continuing.

## References

- `{baseDir}/references/openclaw-environment.md` — local host, workspace, caches, background runs
- `{baseDir}/references/azure-foundry-openclaw.md` — Foundry gpt-5.3-codex proxy + OpenClaw config
- `{baseDir}/references/git-workflow.md` — branches, baseline, dirty worktree
- `{baseDir}/references/exploration-ideas.md` — hypotheses by symptom
- `{baseDir}/references/experiment-log-template.md` — TSV schema
