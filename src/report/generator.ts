import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportData } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findProjectRoot(): string {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    try {
      readFileSync(join(dir, 'package.json'), 'utf-8');
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  return __dirname;
}

function readFileContent(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

// Use split/join instead of String.replace to avoid $-substitution issues
// in replacement strings (e.g. minified JS containing $1, $&, etc.)
function templateReplace(html: string, placeholder: string, value: string): string {
  return html.split(placeholder).join(value);
}

const isDistBuild = __dirname.includes('dist');

export function generateReport(data: ReportData, outputPath: string): void {
  const projectRoot = findProjectRoot();

  const reportDir = isDistBuild
    ? join(projectRoot, 'dist', 'report')
    : join(projectRoot, 'src', 'report');

  const uiDir = join(reportDir, 'ui');

  // Read template and UI files
  const template = readFileContent(join(reportDir, 'template.html'));
  const styles = readFileContent(join(uiDir, 'styles.css'));
  const graphJS = readFileContent(join(uiDir, 'graph.js'));
  const tableJS = readFileContent(join(uiDir, 'table.js'));
  const cyclesPanelJS = readFileContent(join(uiDir, 'cycles-panel.js'));
  const filtersJS = readFileContent(join(uiDir, 'filters.js'));

  // Assemble HTML
  let html = template;
  html = templateReplace(html, '{{STYLES}}', styles);
  html = templateReplace(html, '{{DATA}}', JSON.stringify(data));
  html = templateReplace(html, '{{GRAPH_JS}}', graphJS);
  html = templateReplace(html, '{{TABLE_JS}}', tableJS);
  html = templateReplace(html, '{{CYCLES_PANEL_JS}}', cyclesPanelJS);
  html = templateReplace(html, '{{FILTERS_JS}}', filtersJS);

  writeFileSync(outputPath, html);
}
