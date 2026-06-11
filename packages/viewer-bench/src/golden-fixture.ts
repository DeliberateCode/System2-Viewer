/**
 * Golden fixture definitions for symbol extraction validation.
 *
 * Each fixture contains a hand-curated source file and the expected
 * symbols and imports that the extraction pipeline should produce.
 * Used by the symbol coverage evaluator to measure extraction accuracy.
 */

export interface ExpectedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'method' | 'lambda' | 'other';
  exported: boolean;
}

export interface ExpectedImport {
  source: string;
  names?: string[];
}

export interface GoldenFixture {
  language: string;
  sourceFile: string;
  expectedSymbols: ExpectedSymbol[];
  expectedImports: ExpectedImport[];
}

// --- TypeScript golden fixture ---

const TS_SOURCE = `\
import { EventEmitter } from 'node:events';
import type { Config } from './config.js';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export type UserId = string;

export class UserService extends EventEmitter {
  private users: Map<string, UserRecord>;

  constructor() {
    super();
    this.users = new Map();
  }

  getUser(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

  addUser(record: UserRecord): void {
    this.users.set(record.id, record);
    this.emit('userAdded', record);
  }
}

export function createUserService(): UserService {
  return new UserService();
}

export const DEFAULT_PAGE_SIZE = 25;

function validateEmail(email: string): boolean {
  return email.includes('@');
}
`;

const TS_FIXTURE: GoldenFixture = {
  language: 'typescript',
  sourceFile: TS_SOURCE,
  expectedSymbols: [
    { name: 'UserRecord', kind: 'interface', exported: true },
    { name: 'UserId', kind: 'type', exported: true },
    { name: 'UserService', kind: 'class', exported: true },
    { name: 'createUserService', kind: 'function', exported: true },
    { name: 'DEFAULT_PAGE_SIZE', kind: 'variable', exported: true },
    { name: 'validateEmail', kind: 'function', exported: false },
  ],
  expectedImports: [
    { source: 'node:events', names: ['EventEmitter'] },
    { source: './config.js', names: ['Config'] },
  ],
};

// --- Python golden fixture ---

const PY_SOURCE = `\
from typing import List, Optional, Dict
from dataclasses import dataclass
from pathlib import Path

MAX_RETRIES: int = 5
_INTERNAL_CACHE: Dict[str, object] = {}

@dataclass
class DataRecord:
    id: str
    value: float
    tags: List[str]

class DataProcessor:
    """Processes data records with configurable strategy."""

    def __init__(self, strategy: str = "default") -> None:
        self.strategy = strategy
        self._cache: Dict[str, DataRecord] = {}

    def process(self, record: DataRecord) -> Dict[str, float]:
        return {"id": hash(record.id), "value": record.value}

    def batch_process(self, records: List[DataRecord]) -> List[Dict[str, float]]:
        return [self.process(r) for r in records]

def process_data(items: List[int]) -> List[int]:
    return [x * 2 for x in items]

def load_config(path: Path) -> Dict[str, str]:
    return {}

__all__ = ["DataProcessor", "DataRecord", "process_data", "load_config"]
`;

const PY_FIXTURE: GoldenFixture = {
  language: 'python',
  sourceFile: PY_SOURCE,
  expectedSymbols: [
    { name: 'MAX_RETRIES', kind: 'variable', exported: true },
    { name: '_INTERNAL_CACHE', kind: 'variable', exported: false },
    { name: 'DataRecord', kind: 'class', exported: true },
    { name: 'DataProcessor', kind: 'class', exported: true },
    { name: 'process_data', kind: 'function', exported: true },
    { name: 'load_config', kind: 'function', exported: true },
  ],
  expectedImports: [
    { source: 'typing', names: ['List', 'Optional', 'Dict'] },
    { source: 'dataclasses', names: ['dataclass'] },
    { source: 'pathlib', names: ['Path'] },
  ],
};

// --- Rust golden fixture ---

const RS_SOURCE = `\
use std::collections::HashMap;
use std::io::{self, Read};
use serde::{Deserialize, Serialize};

pub const MAX_BUFFER_SIZE: usize = 8192;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub name: String,
    pub value: i64,
    pub options: HashMap<String, String>,
}

pub trait Configurable {
    fn configure(&mut self, config: &Config);
    fn validate(&self) -> bool;
}

pub struct Parser {
    buffer: Vec<u8>,
    config: Config,
}

impl Parser {
    pub fn new(config: Config) -> Self {
        Parser {
            buffer: Vec::with_capacity(MAX_BUFFER_SIZE),
            config,
        }
    }

    pub fn parse(&self, input: &str) -> Result<Config, String> {
        if input.is_empty() {
            return Err("empty input".to_string());
        }
        Ok(self.config.clone())
    }
}

impl Configurable for Parser {
    fn configure(&mut self, config: &Config) {
        self.config = config.clone();
    }

    fn validate(&self) -> bool {
        !self.config.name.is_empty()
    }
}

pub fn parse_config(input: &str) -> Result<Config, String> {
    let parser = Parser::new(Config {
        name: String::new(),
        value: 0,
        options: HashMap::new(),
    });
    parser.parse(input)
}

fn internal_validate(data: &[u8]) -> bool {
    !data.is_empty()
}
`;

const RS_FIXTURE: GoldenFixture = {
  language: 'rust',
  sourceFile: RS_SOURCE,
  expectedSymbols: [
    { name: 'MAX_BUFFER_SIZE', kind: 'variable', exported: true },
    { name: 'Config', kind: 'class', exported: true },
    { name: 'Configurable', kind: 'interface', exported: true },
    { name: 'Parser', kind: 'class', exported: true },
    { name: 'parse_config', kind: 'function', exported: true },
    { name: 'internal_validate', kind: 'function', exported: false },
  ],
  expectedImports: [
    { source: 'std::collections::HashMap' },
    { source: 'std::io', names: ['self', 'Read'] },
    { source: 'serde', names: ['Deserialize', 'Serialize'] },
  ],
};

// --- Go golden fixture ---

const GO_SOURCE = `\
package server

import (
\t"context"
\t"fmt"
\t"net/http"
\t"sync"
)

const DefaultPort = 8080

var ErrNotFound = fmt.Errorf("not found")

type Server struct {
\tPort    int
\tHandler http.Handler
\tmu      sync.Mutex
}

type RequestContext struct {
\tCtx    context.Context
\tMethod string
\tPath   string
}

func NewServer(port int) *Server {
\treturn &Server{
\t\tPort: port,
\t}
}

func (s *Server) Start() error {
\taddr := fmt.Sprintf(":%d", s.Port)
\treturn http.ListenAndServe(addr, s.Handler)
}

func (s *Server) HandleRequest(ctx RequestContext) (string, error) {
\ts.mu.Lock()
\tdefer s.mu.Unlock()
\treturn fmt.Sprintf("handled %s %s", ctx.Method, ctx.Path), nil
}

func parseRoute(path string) (string, string) {
\treturn path, ""
}

func validatePort(port int) bool {
\treturn port > 0 && port < 65536
}
`;

const GO_FIXTURE: GoldenFixture = {
  language: 'go',
  sourceFile: GO_SOURCE,
  expectedSymbols: [
    { name: 'DefaultPort', kind: 'variable', exported: true },
    { name: 'ErrNotFound', kind: 'variable', exported: true },
    { name: 'Server', kind: 'class', exported: true },
    { name: 'RequestContext', kind: 'class', exported: true },
    { name: 'NewServer', kind: 'function', exported: true },
    { name: 'Start', kind: 'function', exported: true },
    { name: 'HandleRequest', kind: 'function', exported: true },
    { name: 'parseRoute', kind: 'function', exported: false },
    { name: 'validatePort', kind: 'function', exported: false },
  ],
  expectedImports: [
    { source: 'context' },
    { source: 'fmt' },
    { source: 'net/http' },
    { source: 'sync' },
  ],
};

export const GOLDEN_FIXTURES: readonly GoldenFixture[] = [
  TS_FIXTURE,
  PY_FIXTURE,
  RS_FIXTURE,
  GO_FIXTURE,
];

// --- Golden query results for retrieval accuracy regression detection ---

/** A golden query result that specifies expected minimum results for a retrieval operation. */
export interface GoldenQueryResult {
  op: string;
  args: Record<string, unknown>;
  expectedMinResults: number;
  expectedContains?: string[];
}

/**
 * Golden query fixtures for the sample-monorepo test fixture.
 * These define minimum accuracy expectations for retrieval operations.
 */
export const GOLDEN_QUERY_FIXTURES: readonly GoldenQueryResult[] = [
  {
    op: 'estimateBlastRadius',
    args: { changeScope: ['packages/core/src/index.ts'] },
    expectedMinResults: 3,
    expectedContains: ['packages/core/src/index.ts'],
  },
  {
    op: 'traceFlow',
    args: { start: 'packages/api/src/index.ts', targetOrIntent: 'core' },
    expectedMinResults: 1,
  },
  {
    op: 'findEntrypoints',
    args: { query: 'server' },
    expectedMinResults: 1,
    expectedContains: ['server'],
  },
];
