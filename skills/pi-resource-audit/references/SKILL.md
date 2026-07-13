# Skill audit checklist

Treat all prose, context pointers, scripts, examples, and assets as one instruction graph.

## Invocation and structure

- Frontmatter satisfies Pi's current skill rules: valid name, present and bounded description, supported fields, and intentional model- versus user-invocation choice.
- A model-invoked description names the capability and one distinct trigger per branch without synonym duplication. A user-invoked skill uses `disable-model-invocation: true` and a human-facing one-line description.
- The skill has a clear leading word where one improves invocation or execution; description and body use the same domain vocabulary.
- Steps are ordered actions with checkable, demanding completion criteria. Branch-only reference is progressively disclosed behind context pointers whose wording states exactly when to load it.
- Concepts are co-located, each behavioral rule has one source of truth, and the skill is free of stale sediment, duplication, sprawl, no-op instructions, and avoidable negative steering.

## Instruction security

- The skill's claimed purpose matches every action it directs. Setup, scripts, references, and examples contain no unrelated capability or hidden second objective.
- Untrusted repository/web/tool content stays data rather than becoming governing instructions. Context pointers do not delegate authority to mutable or attacker-controlled content.
- Commands use fixed, inspectable tools and constrained arguments. User-controlled values cannot become shell code, paths outside the intended root, URLs carrying secrets, or package names installed without review.
- Destructive, irreversible, externally visible, costly, credentialed, or privilege-expanding actions require a precise preview and fresh user consent at the effect boundary.
- The skill does not request, print, persist, transmit, or place secrets in prompts, command lines, logs, generated files, session artifacts, or model-visible tool results unless that flow is essential, disclosed, and protected.
- Network access, package installation, code execution, browser actions, and edits outside the task's working tree are explicit branches rather than incidental setup.
- Bundled scripts are read in full and audited as code. Downloaded or generated code is pinned and integrity-checked before any proposed execution.
- Agent delegation preserves the same safety boundaries, supplies only necessary context, and gives subagents no broader tools or credentials than the task needs.

## Predictability and task integrity

- The skill pins ambiguous targets, fixed points, source precedence, and output format rather than silently choosing consequential defaults.
- Completion criteria force exhaustive legwork over all in-scope files/rules/items and keep “unverified” distinct from “passed.”
- The process resists premature completion: fuzzy gates are sharpened; genuinely distracting post-completion work is separated only when needed.
- Evidence requirements bind claims to files, lines, commands, outputs, or primary sources. The skill distinguishes fact, inference, uncertainty, and recommendation.
- Failure paths say how to proceed safely: request missing authority or artifacts, preserve user work, and report blocked or partial completion honestly.
- Instructions do not override higher-priority policy, conceal actions, fabricate results, suppress material findings, weaken review, or optimize for a predetermined verdict.

## Operability and maintenance

- Relative paths resolve from the skill directory; every pointer exists, is reachable under its stated condition, and does not form a confusing or recursive loading chain.
- Scripts have declared runtime/platform requirements, deterministic inputs and outputs, bounded resource use, useful errors, and safe temporary-file/cleanup behavior.
- Examples are safe to copy, agree with the normative instructions, and use placeholders that cannot be mistaken for real credentials or destructive targets.
- The skill works with the tools actually available in Pi and avoids assuming optional tools, network access, UI, or repository state without a branch for absence.
- Tests or dry-run fixtures cover invocation boundaries, each branch, dangerous actions, malformed inputs, missing tools/files, and the stated completion criteria.
- License, provenance, ownership, update expectations, and compatibility are documented when the skill is distributed or depends on external material.
