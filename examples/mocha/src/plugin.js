// Circular dependency: plugin -> registry -> plugin
import { getPlugin } from './registry.js';

export function createPlugin(name, config) {
  return {
    name,
    config,
    getDependency(depName) {
      return getPlugin(depName);
    },
  };
}
