# Experiment Log Template

Use this as the model for an untracked TSV such as `reports/auto_research_results.tsv`.

For OpenClaw local campaigns, set `launcher` to `local` and `job_id` to `none` unless the user moved the run off-host.

```tsv
index	branch	parent_commit	commit	recipe	metric_name	metric_value	memory_gb	elapsed_min	launcher	job_id	command	log_path	status	description
1	autoresearch/2026-05-20-dapo-qwen2p5-7b-1n1g-dgx-spark/baseline	abc0000	abc1234	examples/configs/recipes/llm/dapo-qwen2.5-7b-1n1g-dgx-spark.yaml	val_accuracy	0.000000	0.0	12.4	local	none	uv run ./examples/run_grpo.py --config examples/configs/recipes/llm/dapo-qwen2.5-7b-1n1g-dgx-spark.yaml	reports/auto_research/2026-05-20-dapo-qwen2p5-7b-1n1g-dgx-spark/baseline/run.log	crash	baseline failed before training
2	autoresearch/2026-05-20-dapo-qwen2p5-7b-1n1g-dgx-spark/prompt-compact-schema	abc1234	def5678	examples/configs/recipes/llm/dapo-qwen2.5-7b-1n1g-dgx-spark.yaml	val_accuracy	0.742100	43.9	58.7	local	none	uv run ./examples/run_grpo.py --config examples/configs/recipes/llm/dapo-qwen2.5-7b-1n1g-dgx-spark.yaml	reports/auto_research/2026-05-20-dapo-qwen2p5-7b-1n1g-dgx-spark/prompt-compact-schema/run.log	keep	compact answer schema
3	autoresearch/2026-05-20-dapo-qwen2p5-7b-1n1g-dgx-spark/rollout-batch-up	abc1234	fedcba9	examples/configs/recipes/llm/dapo-qwen2.5-7b-1n1g-dgx-spark.yaml	val_accuracy	0.751200	44.1	59.8	local	none	uv run ./examples/run_grpo.py --config examples/configs/recipes/llm/dapo-qwen2.5-7b-1n1g-dgx-spark.yaml	reports/auto_research/2026-05-20-dapo-qwen2p5-7b-1n1g-dgx-spark/rollout-batch-up/run.log	discard	raise rollout batch size without prompt changes
```

Suggested interpretation:
- `index` is the attempted experiment count; use it for rules like `do 50 experiments`
- `parent_commit` records the comparison base; use it to tell clean A/B tests from follow-ups
- `metric_name` and `metric_value` should come from the recipe's authoritative validation or task metric
- `elapsed_min` is the wall-clock duration of the run; sum it or compare it against the remaining budget when the user gives time limits
- `memory_gb` is an auxiliary resource signal, not the target metric
- `launcher` should identify where the run happened; OpenClaw default is `local`
- `job_id` should hold the Slurm job id, Ray/Kubernetes submission id, or `none` for local runs
- `command` should be the exact training command or the submitted script path
- `log_path` should point to the durable run log or run directory
- use `0.000000` and `0.0` for crash rows if no valid metric was produced
- keep the description short and hypothesis-focused
- `branch` should use the shared experiment prefix so all hypotheses stay grouped

Status values:
- `keep`
- `discard`
- `crash`
