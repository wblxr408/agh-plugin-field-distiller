---
name: fde-field-distiller
description: Distill resolved field troubleshooting sessions into reusable Skills and candidate plugins.
---

# Session-to-Skill / Plugin Distiller Playbook

1. **Analyze Before Generating**: Call `fde_distill_analyze` to prune failed retries into explicit anti-patterns and extract the winning canonical sequence.
2. **Distill to Skill First**: For procedural playbooks, call `fde_distill_generate_skill` to produce a linted `SKILL.md` with refusal boundaries.
3. **Scaffold Candidate Plugin for Deterministic Tools**: For repeatable data/API checks, call `fde_distill_generate_plugin` to emit `package.json`, `index.mjs`, and `test/contract.test.mjs`, then hand off to `plugin_helper_create` for human review.
