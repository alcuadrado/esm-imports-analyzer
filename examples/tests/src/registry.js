// Circular dependency: registry -> plugin -> registry
import { createPlugin } from './plugin.js';

const plugins = new Map();

export function register(name, config) {
  const plugin = createPlugin(name, config);
  plugins.set(name, plugin);
  return plugin;
}

export function getPlugin(name) {
  return plugins.get(name);
}

export function listPlugins() {
  return [...plugins.keys()];
}
