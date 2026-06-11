/**
 * Tests for pyproject.toml [project.scripts] parsing.
 */
import { describe, it, expect } from 'vitest';
import { parsePyprojectScripts } from '../indexer.js';

describe('parsePyprojectScripts', () => {
  it('extracts [project.scripts] entries', () => {
    const toml = `
[project]
name = "myapp"

[project.scripts]
myapp = "myapp.cli:main"
helper = "myapp.tools.helper:run"
`;
    const result = parsePyprojectScripts(toml);
    expect(result).toEqual([
      { name: 'myapp', module: 'myapp.cli', func: 'main' },
      { name: 'helper', module: 'myapp.tools.helper', func: 'run' },
    ]);
  });

  it('extracts [project.gui-scripts] entries', () => {
    const toml = `
[project.gui-scripts]
myapp-gui = "myapp.gui:launch"
`;
    const result = parsePyprojectScripts(toml);
    expect(result).toEqual([
      { name: 'myapp-gui', module: 'myapp.gui', func: 'launch' },
    ]);
  });

  it('stops at the next section', () => {
    const toml = `
[project.scripts]
cli = "pkg.cli:main"

[project.optional-dependencies]
dev = ["pytest"]
`;
    const result = parsePyprojectScripts(toml);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('cli');
  });

  it('returns empty for missing sections', () => {
    const toml = `
[project]
name = "mylib"
version = "1.0.0"
`;
    expect(parsePyprojectScripts(toml)).toEqual([]);
  });

  it('skips comments and blank lines inside the section', () => {
    const toml = `
[project.scripts]
# the main entry point
cli = "pkg.cli:main"

# another tool
tool = "pkg.tool:run"
`;
    const result = parsePyprojectScripts(toml);
    expect(result).toHaveLength(2);
  });

  it('skips entries without colon separator', () => {
    const toml = `
[project.scripts]
bad = "not.a.valid.ref"
good = "pkg.mod:func"
`;
    const result = parsePyprojectScripts(toml);
    expect(result).toEqual([
      { name: 'good', module: 'pkg.mod', func: 'func' },
    ]);
  });
});
