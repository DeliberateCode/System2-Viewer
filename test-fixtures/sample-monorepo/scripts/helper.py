#!/usr/bin/env python3
"""
Helper script for build automation.
This is an unsupported language file for partiality testing.
"""

import json
import os
import sys
from pathlib import Path


def find_packages(root: str) -> list[str]:
    """Find all packages in the monorepo."""
    packages_dir = Path(root) / "packages"
    return [p.name for p in packages_dir.iterdir() if p.is_dir()]


def read_package_json(package_path: str) -> dict:
    """Read and parse a package.json file."""
    with open(os.path.join(package_path, "package.json")) as f:
        return json.load(f)


def get_dependencies(package_data: dict) -> list[str]:
    """Extract dependency names from a package.json."""
    deps = package_data.get("dependencies", {})
    dev_deps = package_data.get("devDependencies", {})
    return list(set(list(deps.keys()) + list(dev_deps.keys())))


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    packages = find_packages(root)
    print(f"Found {len(packages)} packages:")
    for pkg in sorted(packages):
        print(f"  - {pkg}")


if __name__ == "__main__":
    main()
