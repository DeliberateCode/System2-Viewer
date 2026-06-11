# Verification Recipes

Verification recipes are small checks that the VerificationEngine runs to
confirm or refute a claim. Each recipe has a `recipeType` and a human-readable
`description`. Custom recipes can be attached to claim types via the
`claimTypes` section of `viewer.config.json`.

## Built-in Recipe Types

| Recipe Type           | What it checks                                      |
|-----------------------|-----------------------------------------------------|
| `source_span_check`   | A source span still exists and matches expectations |
| `symbol_exists_check` | A symbol is still defined in the expected file      |
| `import_edge_check`   | An import relationship between two files still holds|
| `grep_check`          | A text pattern still matches in the target file     |

## Recipe Format

```json
{
  "recipeType": "symbol_exists_check",
  "description": "Verify that createUser is exported from user-model.ts"
}
```

- **recipeType** (required): one of the built-in types, or a custom string
  paired with a `command`.
- **description** (required): explains what the recipe verifies.
- **command** (optional): shell command; exit 0 = pass, non-zero = fail.

## Execution Flow

1. The engine loads the claim's `verificationRecipes` array.
2. Each supported recipe runs against the current model state.
3. All pass: claim promoted to `confirmed`. Any fail: claim marked `refuted`.
4. Unknown recipe types are reported as skipped, not failures.

## Adding Custom Recipes via Config
Define a custom claim type with `defaultVerificationRecipes`:

```json
{
  "claimTypes": [
    {
      "id": "team-owns-module",
      "displayTemplate": "Team {{team}} owns module {{module}}",
      "defaultVerificationRecipes": [
        {
          "recipeType": "grep_check",
          "description": "CODEOWNERS mentions team for module path"
        }
      ],
      "severity": "medium"
    }
  ]
}
```

When the indexer generates a `team-owns-module` claim, it attaches these
recipes. The VerificationEngine runs them during `viewer verify`.
