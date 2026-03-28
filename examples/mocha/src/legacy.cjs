// CJS module — legacy utility
const path = require('node:path');

function resolvePath(base, ...segments) {
  return path.resolve(base, ...segments);
}

function getExtension(filepath) {
  return path.extname(filepath);
}

module.exports = { resolvePath, getExtension };
