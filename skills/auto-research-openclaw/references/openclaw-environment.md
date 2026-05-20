# OpenClaw Local Environment

Use this reference when `auto-research-openclaw` runs on the same machine as the OpenClaw gateway (local mode, loopback bind, or a forwarded sandbox port that still executes on the user's host checkout).

## Repository and workspace

- NeMo-RL code and git branches live in the **repo checkout** OpenClaw is pointed at (often the user's `Dev/NemoRL/RL` clone or a copy under `~/.openclaw/workspace`).
- Keep the git ledger (branches, hypothesis commits) in the repo.
- Keep bulky run artifacts under `reports/auto_research/<campaign>/<experiment>/` inside the repo, **untracked**, unless the user wants them versioned.

Confirm the repo root once per session:

```bash
git rev-parse --show-toplevel
```

## Installing this skill in OpenClaw

Pick one:

1. **extraDirs** — Add the NeMo-RL `skills/` parent or this skill folder to `skills.load.extraDirs` in `openclaw.json`, then `/new` or `openclaw gateway restart`.
2. **Workspace copy** — `cp -R <nemo-rl>/skills/auto-research-openclaw ~/.openclaw/workspace/skills/` (or the agent workspace's `skills/`).
3. **Project agent skills** — Place under `<workspace>/.agents/skills/auto-research-openclaw/`.

Verify: `openclaw skills list | grep auto-research-openclaw`.

Also enable `session-memory` from the same `skills/` tree (or workspace copy).

## Local execution

Default launcher label in the TSV: `local`.

Preflight:

```bash
uv --version
nvidia-smi   # when GPU training is expected
df -h .      # disk for logs and checkpoints
```

Launch pattern:

```bash
cd "$(git rev-parse --show-toplevel)"
LOG_DIR=reports/auto_research/<campaign>/<experiment>
mkdir -p "$LOG_DIR"
uv run <entrypoint> > "$LOG_DIR/run.log" 2>&1
```

Use the exact entrypoint and config path from the recipe (commonly `./examples/run_grpo.py --config ...`).

### Long-running jobs

OpenClaw chat turns should not block on multi-hour training.

- Start the command in **background** (OpenClaw `exec` background or `nohup` with a known PID).
- Record the command, `LOG_DIR`, and start time in `session-memory` / TSV.
- Poll with `tail -n 50 "$LOG_DIR/run.log"` between turns until the process exits or hits timeout.
- On timeout, mark the TSV row `crash` or `discard` per whether the hypothesis was testable.

### Caches and downloads

Prefer a single user-level cache root to avoid filling the repo:

```bash
export HF_HOME="${HF_HOME:-$HOME/.cache/huggingface}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$HOME/.cache/uv}"
```

Override only when the user specifies a different cache location. Do not use Brev `/ephemeral` paths.

### Authentication

- If `<repo>/.env` exists, source it in the shell before `uv run` (never echo values).
- Otherwise rely on the user's existing `WANDB_API_KEY`, `HF_TOKEN`, etc. in the OpenClaw host environment.
- Remind the user to configure missing keys before authenticated runs.

## Progress and handoff

During a campaign, each user-visible update should include:

- campaign prefix and current experiment branch
- latest metric (or `crash`)
- attempted / target experiment count when applicable
- remaining wall-clock budget when applicable
- whether the stop condition is met

Before ending a session or after compaction risk, update `session-memory` `handoff.md` with: objective, stop rules, prefix, last TSV index, best `keep` branch, and path to the latest `run.log`.

## When to leave OpenClaw local mode

If the user asks for Kubernetes, Slurm, or Brev:

- Stop using this skill as the primary playbook.
- Switch to `auto-research` plus `launch-nemo-rl` or `brev-etiquette` as appropriate.
- Do not hybridize cluster launch steps into local OpenClaw runs without explicit user direction.
