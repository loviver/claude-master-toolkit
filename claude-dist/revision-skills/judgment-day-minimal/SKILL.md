---
name: judgment-day-minimal
description: >
  Parallel adversarial review protocol using minimal structured language.
  Two blind judges review the same target in parallel, return concise structured findings
  with all critical context, fixes are applied by a separate agent, and re-judged iteratively.
  Optimized for token efficiency while retaining full precision.
trigger: ["judgment day", "judgment-day", "review adversarial", "dual review",
          "doble review", "juzgar", "que lo juzguen"]
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0-minimal"
---

## Key Differences vs Full JD
- Uses **structured minimal output** instead of verbose text
- Keeps all essential context (file, line, severity, description, fix)
- No free-form prose; avoids unnecessary tokens
- Suitable for Claude or other LLMs where token cost matters
- Compatible with original JD orchestration (delegate + fix agent + re-judge)

---

## Judge Prompt (Minimal, Token-Efficient)

