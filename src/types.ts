export interface ImportRecord {
  specifier: string;
  resolvedURL: string;
  parentURL: string | null;
  resolveStartTime: number;
  resolveEndTime: number;
  loadStartTime: number;
  loadEndTime: number;
}

export interface ModuleNode {
  resolvedURL: string;
  specifier: string;
  totalTime: number;
  children: ModuleNode[];
  parentURL: string | null;
}

export interface Cycle {
  modules: string[];
  length: number;
}

export interface FolderTreeNode {
  id: string;
  label: string;
  type: 'folder' | 'file';
  moduleURL?: string;
  children: FolderTreeNode[];
}

export interface Group {
  id: string;
  label: string;
  packageJsonPath: string;
  modules: string[];
  isNodeModules: boolean;
  folderTree?: FolderTreeNode[];
}

export interface ReportData {
  metadata: {
    command: string;
    timestamp: string;
    nodeVersion: string;
    totalModules: number;
    totalTime: number;
  };
  modules: ImportRecord[];
  tree: ModuleNode[];
  groups: Group[];
  cycles: Cycle[];
}
