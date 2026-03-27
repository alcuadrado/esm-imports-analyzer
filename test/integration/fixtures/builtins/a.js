import fs from 'node:fs';
import path from 'node:path';
export const result = fs.existsSync(path.resolve('.'));
