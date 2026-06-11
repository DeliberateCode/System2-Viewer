# Gate 1 Pre-Delegation: Viewer Consultation

Before delegating the context-gathering work, consider consulting the viewer for an initial orientation of the repository.

## Readiness Check

Run `viewer.doctor` first to confirm the viewer model is indexed and current. If the doctor report indicates the model is unready or stale, skip this consultation and proceed with Gate 1 normally.

## Suggested Queries

1. **Repository overview**: Call `viewer.getRepositoryOverview` to obtain a structured summary of the codebase -- languages, directory structure, candidate subsystems, candidate entrypoints, and top claims. This can seed the context document with structural facts backed by stored evidence.

2. **Entrypoint discovery**: Call `viewer.findEntrypoints` with the user's stated goal or domain keywords. The results include ranked candidates with evidence references, which can inform where spec-coordinator should focus.

## Integrating Findings

Distill the viewer's findings into the delegation contract Inputs for spec-coordinator. Include:
- A compact summary of repository structure and key subsystems
- Candidate entrypoints relevant to the stated goal
- Confidence bands and any noted uncertainties or partiality

Viewer findings are advisory. They provide a starting point for context gathering, not a definitive answer.

## Environment

The user should set the `VIEWER_PATH` environment variable to the absolute path of the System2-viewer installation so the MCP server can locate its entry point.

If the viewer is not configured or `VIEWER_PATH` is unset, skip this consultation and proceed normally.
