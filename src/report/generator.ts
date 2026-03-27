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

  // Read cytoscape vendor libs
  // In dist (published): bundled into dist/vendor/ at build time
  // In dev: read directly from node_modules
  let cytoscapeJS: string;
  let coseBilkentJS: string;
  let expandCollapseJS: string;

  if (isDistBuild) {
    const vendorDir = join(projectRoot, 'dist', 'vendor');
    cytoscapeJS = readFileContent(join(vendorDir, 'cytoscape.min.js'));
    coseBilkentJS = readFileContent(join(vendorDir, 'cytoscape-cose-bilkent.js'));
    expandCollapseJS = readFileContent(join(vendorDir, 'cytoscape-expand-collapse.js'));
  } else {
    const nodeModulesDir = join(projectRoot, 'node_modules');
    cytoscapeJS = readFileContent(join(nodeModulesDir, 'cytoscape', 'dist', 'cytoscape.min.js'));
    coseBilkentJS = readFileContent(join(nodeModulesDir, 'cytoscape-cose-bilkent', 'cytoscape-cose-bilkent.js'));
    expandCollapseJS = readFileContent(join(nodeModulesDir, 'cytoscape-expand-collapse', 'cytoscape-expand-collapse.js'));
  }

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
