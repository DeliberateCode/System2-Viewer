# Viewer Evidence Principle

system2-viewer is an **advisory** evidence source. It provides structured findings about repository structure, claims, and confidence scores, but it is never authoritative ground truth.

When relaying viewer findings to subagents or incorporating them into decisions:

- Preserve hedge and uncertainty markers exactly as returned. Every finding carries a confidence band (none, low, medium, high) and a freshness band (stale, aging, fresh). Relay these verbatim rather than interpreting them as certainties.
- Preserve each finding's backing tags (`[claim:<id>]`, `[evidence:<id>]`, `[hypothesis]`). These tags allow traceability back to the model and should not be stripped or summarized away.
- When delegating viewer findings to subagents, fold a compact summary into the delegation contract Inputs section. Include the confidence band and key claim IDs so the subagent can query further if needed.
- Treat viewer output as one input among many. Viewer findings may be incomplete (see partiality fields), stale, or low-confidence. Weigh them alongside direct source reading, test results, and human input.

If the viewer model is unready, stale, or unavailable, skip consultation and proceed with the task normally. The viewer is strictly optional and never gates progress.
