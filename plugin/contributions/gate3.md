# Gate 3 Pre-Delegation: Viewer Consultation

Before delegating the design work, consider consulting the viewer for impact analysis relevant to the proposed changes.

## Readiness Check

Run `viewer.doctor` first to confirm the viewer model is indexed and current. If the doctor report indicates the model is unready or stale, skip this consultation and proceed with Gate 3 normally.

## Suggested Queries

1. **Blast radius estimation**: Call `viewer.estimateBlastRadius` with the file paths or symbols expected to change. The result is recall-prioritized -- it includes every reachable node through any dependency edge, with uncertain edges flagged separately. This helps the design-architect understand the scope of downstream impact.

2. **Scoped uncertainties**: Call `viewer.listUncertainties` with a scope narrowed to the affected area. This surfaces low-confidence claims, stale data, contradictions, and ambiguous subsystem memberships that may affect design decisions.

## Integrating Findings

Distill the viewer's findings into the delegation contract Inputs for design-architect. Include:
- A compact summary of the estimated blast radius (affected files, packages, subsystems)
- Risky or uncertain edges that the design should account for
- Any contradictions or low-confidence claims in the affected area

Viewer findings are advisory. They highlight areas of potential impact and uncertainty, not definitive constraints on the design.

If the viewer is not configured or unavailable, skip this consultation and proceed normally.
