import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportData } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findProjectRoot(): string {
  // Walk up from __dirname to find package.json
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

export function generateReport(data: ReportData, outputPath: string): void {
  const projectRoot = findProjectRoot();

  // Determine source paths — check if we're running from src/ (dev) or dist/ (published)
  const srcDir = __dirname.includes('dist')
    ? join(projectRoot, 'dist', 'report')
    : join(projectRoot, 'src', 'report');

  const uiDir = __dirname.includes('dist')
    ? join(projectRoot, 'dist', 'report', 'ui')
    : join(projectRoot, 'src', 'report', 'ui');

  // Read template
  const template = readFileContent(join(srcDir, 'template.html'));

  // Read UI files
  const styles = readFileContent(join(uiDir, 'styles.css'));
  const graphJS = readFileContent(join(uiDir, 'graph.js'));
  const tableJS = readFileContent(join(uiDir, 'table.js'));
  const cyclesPanelJS = readFileContent(join(uiDir, 'cycles-panel.js'));
  const filtersJS = readFileContent(join(uiDir, 'filters.js'));

  // Read cytoscape from node_modules
  const nodeModulesDir = join(projectRoot, 'node_modules');
  const cytoscapeJS = readFileContent(join(nodeModulesDir, 'cytoscape', 'dist', 'cytoscape.min.js'));
  const coseBilkentJS = readFileContent(join(nodeModulesDir, 'cytoscape-cose-bilkent', 'cytoscape-cose-bilkent.js'));
  const expandCollapseJS = readFileContent(join(nodeModulesDir, 'cytoscape-expand-collapse', 'cytoscape-expand-collapse.js'));

  // Assemble HTML
  let html = template;
  html = html.replace('{{STYLES}}', styles);
  html = html.replace('{{DATA}}', JSON.stringify(data));
  html = html.replace('{{CYTOSCAPE_JS}}', `<script>${cytoscapeJS}</script>`);
  html = html.replace('{{CYTOSCAPE_COSE_BILKENT_JS}}', `<script>${coseBilkentJS}</script>`);
  html = html.replace('{{CYTOSCAPE_EXPAND_COLLAPSE_JS}}', `<script>${expandCollapseJS}</script>`);
  html = html.replace('{{GRAPH_JS}}', graphJS);
  html = html.replace('{{TABLE_JS}}', tableJS);
  html = html.replace('{{CYCLES_PANEL_JS}}', cyclesPanelJS);
  html = html.replace('{{FILTERS_JS}}', filtersJS);

  writeFileSync(outputPath, html);
}
