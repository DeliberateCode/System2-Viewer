#!/usr/bin/env node
import { createViewerEngine, McpToolServer } from './packages/viewer-surface/dist/index.js';

const engine = createViewerEngine();
const server = new McpToolServer();

process.once('exit', () => engine.close());

server.register(engine, engine.feedback, engine.indexer);
await server.start();
