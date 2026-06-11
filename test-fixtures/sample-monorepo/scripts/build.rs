// Build helper in Rust (unsupported language for partiality testing)
//
// This file demonstrates a Rust source file that would be
// encountered during indexing but cannot be parsed by the
// tree-sitter TypeScript grammar.

use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let root = env::current_dir().expect("Failed to get current directory");
    let packages_dir = root.join("packages");

    println!("Scanning packages in: {}", packages_dir.display());

    if let Ok(entries) = fs::read_dir(&packages_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let pkg_json = path.join("package.json");
                if pkg_json.exists() {
                    println!("Found package: {}", path.file_name().unwrap().to_string_lossy());
                }
            }
        }
    }
}

struct PackageInfo {
    name: String,
    version: String,
    dependencies: Vec<String>,
}

impl PackageInfo {
    fn new(name: &str, version: &str) -> Self {
        PackageInfo {
            name: name.to_string(),
            version: version.to_string(),
            dependencies: Vec::new(),
        }
    }

    fn add_dependency(&mut self, dep: &str) {
        self.dependencies.push(dep.to_string());
    }
}

trait Buildable {
    fn build(&self) -> Result<(), String>;
    fn clean(&self) -> Result<(), String>;
}

impl Buildable for PackageInfo {
    fn build(&self) -> Result<(), String> {
        println!("Building {} v{}", self.name, self.version);
        Ok(())
    }

    fn clean(&self) -> Result<(), String> {
        println!("Cleaning {} v{}", self.name, self.version);
        Ok(())
    }
}
