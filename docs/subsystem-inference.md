# Subsystem Inference

System2 Viewer automatically infers subsystem boundaries during indexing.
All inferred subsystems are **hypothesis claims**, never confirmed facts.
Users can confirm, reject, or override them via feedback commands or by
defining explicit subsystems in `viewer.config.json`.

## Inference Heuristics

The indexer applies three strategies in order. Results are deduplicated by ID;
the first source wins when two strategies produce the same subsystem ID.

### 1. Directory-based grouping

Top-level directories containing two or more source files become subsystem
candidates. Hidden directories (`.git`, `.vscode`) and common non-source
directories (`node_modules`, `dist`) are excluded.

- **ID**: `subsystem::dir::<dirname>`, **Confidence**: `low`
- **Paths**: `<dirname>/**`

### 2. Package boundary analysis

Each npm workspace package discovered during indexing becomes a subsystem
candidate. The indexer reads `package.json` workspace definitions to find
package roots.

- **ID**: `subsystem::package::<package-name>`, **Confidence**: `medium`
- **Paths**: `<package-path>/**`

Package-based subsystems are higher confidence because `package.json`
boundaries are an explicit developer choice.

### 3. Co-change clustering

Files that appear together in three or more git commits are grouped using
union-find clustering. Only clusters with three or more files produce a
subsystem candidate.

- **ID**: `subsystem::cochange::cluster-<n>`, **Confidence**: `low`
- **Paths**: list of individual file paths in the cluster

Co-change clusters surface implicit coupling that may not match directory
or package boundaries.

## Overriding Inferred Subsystems

To pin subsystem definitions, add them to `viewer.config.json`:

```json
{
  "subsystems": [
    { "id": "core", "name": "Core Library", "paths": ["packages/core/**"] }
  ]
}
```

Config-defined subsystems with `source: "config"` take precedence over
inferred ones during claim generation.

## Confirming or Rejecting

Use feedback commands to promote or dismiss inferred subsystems:

```
viewer confirm <claimId> --actor <name>
viewer reject  <claimId> --actor <name>
```

Confirmed subsystems persist across re-indexes. Rejected subsystems are
suppressed until the underlying evidence changes.
