/* global cytoscape, document */

// Web Worker source that runs dagre layout off the main thread.
var DAGRE_WORKER_SRC = [
  'importScripts("https://unpkg.com/dagre@0.7.4/dist/dagre.js");',
  '',
  'self.onmessage = function (e) {',
  '  var msg = e.data;',
  '  var g = new dagre.graphlib.Graph({ compound: true, multigraph: true });',
  '  g.setGraph({',
  '    rankdir: msg.rankDir || "TB",',
  '    nodesep: msg.nodeSep || 40,',
  '    edgesep: msg.edgeSep || 10,',
  '    ranksep: msg.rankSep || 60,',
  '  });',
  '  g.setDefaultEdgeLabel(function () { return {}; });',
  '',
  '  for (var i = 0; i < msg.nodes.length; i++) {',
  '    var n = msg.nodes[i];',
  '    g.setNode(n.id, { width: n.width, height: n.height, label: n.id });',
  '    if (n.parent) g.setParent(n.id, n.parent);',
  '  }',
  '  for (var j = 0; j < msg.edges.length; j++) {',
  '    var ed = msg.edges[j];',
  '    g.setEdge(ed.source, ed.target, {}, ed.id);',
  '  }',
  '',
  '  dagre.layout(g);',
  '',
  '  var positions = {};',
  '  g.nodes().forEach(function (id) {',
  '    var nd = g.node(id);',
  '    if (nd) positions[id] = { x: nd.x, y: nd.y };',
  '  });',
  '  self.postMessage(positions);',
  '};',
].join('\n');

var layoutOverlay = null;
var collapsedGroups = new Set();
var autoRelayout = true;

// Folder tree state
var groupFolderTrees = {};   // groupId -> FolderTreeNode[] (top-level children)
var folderState = {};         // folderNodeId -> { children: FolderTreeNode[], groupId: string }
var parentFolderOf = {};      // nodeId (file or folder) -> parent folderNodeId | null
var expandedFolders = new Set();
// Set of group IDs that have folder trees
var groupsWithFolderTree = new Set();

function showOverlay() {
  if (!layoutOverlay) layoutOverlay = document.getElementById('layout-overlay');
  if (layoutOverlay) layoutOverlay.classList.remove('hidden');
}

function hideOverlay() {
  if (!layoutOverlay) layoutOverlay = document.getElementById('layout-overlay');
  if (layoutOverlay) layoutOverlay.classList.add('hidden');
}

function runLayout(cy, callback) {
  showOverlay();

  var nodes = [];
  var edges = [];
  var visibleNodeIds = new Set();
  var expandedGroupIds = new Set();

  cy.nodes(':visible').forEach(function (node) {
    var isGroup = node.hasClass('group');
    if (isGroup && !collapsedGroups.has(node.id())) {
      expandedGroupIds.add(node.id());
      visibleNodeIds.add(node.id());
      return;
    }
    visibleNodeIds.add(node.id());
    var parentId = null;
    if (node.parent().length > 0 && expandedGroupIds.has(node.parent().id())) {
      parentId = node.parent().id();
    }
    nodes.push({
      id: node.id(),
      width: node.outerWidth() || 60,
      height: node.outerHeight() || 40,
      parent: parentId,
    });
  });

  expandedGroupIds.forEach(function (gid) {
    nodes.push({ id: gid, width: 0, height: 0, parent: null });
  });

  cy.edges(':visible').forEach(function (edge) {
    if (visibleNodeIds.has(edge.source().id()) && visibleNodeIds.has(edge.target().id())) {
      edges.push({ id: edge.id(), source: edge.source().id(), target: edge.target().id() });
    }
  });

  var blob = new Blob([DAGRE_WORKER_SRC], { type: 'application/javascript' });
  var url = URL.createObjectURL(blob);
  var worker = new Worker(url);

  worker.onmessage = function (e) {
    var positions = e.data;
    cy.batch(function () {
      cy.nodes().forEach(function (node) {
        if (expandedGroupIds.has(node.id())) return;
        var pos = positions[node.id()];
        if (pos) node.position(pos);
      });
    });
    cy.fit(undefined, 30);
    hideOverlay();
    worker.terminate();
    URL.revokeObjectURL(url);
    if (callback) callback();
  };

  worker.onerror = function () {
    hideOverlay();
    worker.terminate();
    URL.revokeObjectURL(url);
    if (callback) callback();
  };

  worker.postMessage({ nodes: nodes, edges: edges, rankDir: 'TB', nodeSep: 40, edgeSep: 10, rankSep: 60 });
}

function maybeRelayout(cy) {
  if (autoRelayout) runLayout(cy);
}

// Resolve a module URL to its nearest visible ancestor node ID.
// Walks: module -> parent folder -> ... -> parent group
function resolveVisibleNode(cy, moduleURL) {
  // Check if the module node itself is visible
  var node = cy.getElementById(moduleURL);
  if (node.length > 0 && node.visible()) return moduleURL;

  // Walk up through parent folders
  var folderId = parentFolderOf[moduleURL];
  while (folderId) {
    var folderNode = cy.getElementById(folderId);
    if (folderNode.length > 0 && folderNode.visible()) return folderId;
    folderId = parentFolderOf[folderId];
  }

  // Fall back to parent group
  if (node.length > 0 && node.parent().length > 0) return node.parent().id();
  return moduleURL;
}

function refreshEdgeVisibility(cy) {
  cy.batch(function () {
    cy.edges('.meta-edge').remove();

    var metaEdges = {};

    cy.edges().forEach(function (edge) {
      var srcId = edge.source().id();
      var tgtId = edge.target().id();

      var effectiveSrc = resolveVisibleNode(cy, srcId);
      var effectiveTgt = resolveVisibleNode(cy, tgtId);

      // Both resolved to themselves = both visible, show the real edge
      if (effectiveSrc === srcId && effectiveTgt === tgtId) {
        edge.show();
        return;
      }

      // At least one resolved to a different node — hide real edge, collect meta-edge
      edge.hide();

      if (effectiveSrc === effectiveTgt) return;

      var key = effectiveSrc + '||' + effectiveTgt;
      if (!metaEdges[key]) {
        metaEdges[key] = { source: effectiveSrc, target: effectiveTgt, count: 0 };
      }
      metaEdges[key].count++;
    });

    var toAdd = [];
    var keys = Object.keys(metaEdges);
    for (var i = 0; i < keys.length; i++) {
      var me = metaEdges[keys[i]];
      toAdd.push({
        group: 'edges',
        data: {
          id: 'meta-' + keys[i],
          source: me.source,
          target: me.target,
          specifier: me.count + ' imports',
        },
        classes: 'meta-edge',
      });
    }
    if (toAdd.length > 0) cy.add(toAdd);
  });
}

function selectAndHighlight(cy, node) {
  cy.nodes().unselect();
  node.select();
  applySelectionHighlight(cy);
}

// Expand a group: show top-level folder tree children (or all children if no tree)
function expandGroup(cy, groupNode) {
  collapsedGroups.delete(groupNode.id());
  groupNode.removeClass('collapsed');

  var gid = groupNode.data('groupId');
  var tree = groupFolderTrees[gid];

  cy.batch(function () {
    if (tree && tree.length > 0) {
      // Show only top-level folder tree children
      for (var i = 0; i < tree.length; i++) {
        cy.getElementById(tree[i].id).show();
      }
    } else {
      // No folder tree — show all children flat
      groupNode.children().show();
    }
  });

  refreshEdgeVisibility(cy);
  maybeRelayout(cy);
  selectAndHighlight(cy, groupNode);
}

// Collapse a group: hide ALL children, reset folder expansion state
function collapseGroup(cy, groupNode) {
  collapsedGroups.add(groupNode.id());
  groupNode.addClass('collapsed');

  var gid = groupNode.data('groupId');

  cy.batch(function () {
    groupNode.children().hide();
  });

  // Reset folder expansion state for this group
  var toDelete = [];
  expandedFolders.forEach(function (fid) {
    var fs = folderState[fid];
    if (fs && fs.groupId === gid) toDelete.push(fid);
  });
  for (var i = 0; i < toDelete.length; i++) {
    expandedFolders.delete(toDelete[i]);
  }

  refreshEdgeVisibility(cy);
  maybeRelayout(cy);
  selectAndHighlight(cy, groupNode);
}

// Expand a folder: hide the folder node, show its children
function expandFolder(cy, folderNodeId) {
  var state = folderState[folderNodeId];
  if (!state) return;

  expandedFolders.add(folderNodeId);

  var childIds = [];
  cy.batch(function () {
    cy.getElementById(folderNodeId).hide();
    for (var i = 0; i < state.children.length; i++) {
      var childId = state.children[i].id;
      cy.getElementById(childId).show();
      childIds.push(childId);
    }
  });

  refreshEdgeVisibility(cy);
  maybeRelayout(cy);

  // Select the newly revealed children
  cy.nodes().unselect();
  for (var j = 0; j < childIds.length; j++) {
    cy.getElementById(childIds[j]).select();
  }
  applySelectionHighlight(cy);
}

// Ensure a module node is visible by expanding its group and ancestor folders
function revealModule(cy, moduleURL) {
  var node = cy.getElementById(moduleURL);
  if (node.length === 0) return;

  // Expand parent group if collapsed
  if (node.parent().length > 0 && collapsedGroups.has(node.parent().id())) {
    expandGroup(cy, node.parent());
  }

  // Collect ancestor folders that need expanding (outermost first)
  var chain = [];
  var fid = parentFolderOf[moduleURL];
  while (fid) {
    if (!expandedFolders.has(fid)) chain.push(fid);
    fid = parentFolderOf[fid];
  }
  chain.reverse();
  for (var i = 0; i < chain.length; i++) {
    expandFolder(cy, chain[i]);
  }
}

function collapseAll(cy) {
  cy.nodes('.group').forEach(function (groupNode) {
    collapsedGroups.add(groupNode.id());
    groupNode.addClass('collapsed');
  });
  expandedFolders.clear();
  cy.batch(function () {
    cy.nodes('.group').forEach(function (groupNode) {
      groupNode.children().hide();
    });
  });
  refreshEdgeVisibility(cy);
}

function expandAll(cy) {
  cy.batch(function () {
    // Expand all groups
    cy.nodes('.group').forEach(function (groupNode) {
      collapsedGroups.delete(groupNode.id());
      groupNode.removeClass('collapsed');
    });

    // Expand all folders: hide folder nodes, show their children
    var changed = true;
    while (changed) {
      changed = false;
      cy.nodes('.folder:visible').forEach(function (fNode) {
        var state = folderState[fNode.id()];
        if (state && !expandedFolders.has(fNode.id())) {
          expandedFolders.add(fNode.id());
          fNode.hide();
          for (var i = 0; i < state.children.length; i++) {
            cy.getElementById(state.children[i].id).show();
          }
          changed = true;
        }
      });
    }

    // Show any remaining module nodes that might still be hidden
    cy.nodes('.module').forEach(function (node) {
      node.show();
    });
  });

  refreshEdgeVisibility(cy);
}

// --- Directional selection highlighting ---
var HL_CLASSES = ['hl-selected', 'hl-outgoing', 'hl-incoming', 'dimmed'];

function clearSelectionHighlight(cy) {
  for (var i = 0; i < HL_CLASSES.length; i++) {
    cy.elements().removeClass(HL_CLASSES[i]);
  }
}

function applySelectionHighlight(cy) {
  var selected = cy.nodes(':selected');
  if (selected.length === 0) {
    clearSelectionHighlight(cy);
    return;
  }

  for (var i = 0; i < HL_CLASSES.length; i++) {
    cy.elements().removeClass(HL_CLASSES[i]);
  }

  var highlighted = cy.collection();

  function isSelectedOrParent(n) {
    return n.hasClass('hl-selected');
  }

  function traceEdges(node) {
    // Outgoing edges from this node
    var outEdges = node.outgoers('edge:visible');
    outEdges.addClass('hl-outgoing');
    highlighted = highlighted.union(outEdges);
    outEdges.targets().forEach(function (t) {
      if (!isSelectedOrParent(t)) t.addClass('hl-outgoing');
      highlighted = highlighted.union(t);
    });

    // Incoming edges to this node
    var inEdges = node.incomers('edge:visible');
    inEdges.addClass('hl-incoming');
    highlighted = highlighted.union(inEdges);
    inEdges.sources().forEach(function (s) {
      if (!isSelectedOrParent(s) && !s.hasClass('hl-outgoing')) s.addClass('hl-incoming');
      highlighted = highlighted.union(s);
    });

    // Follow meta-edges for group and folder nodes
    if (node.hasClass('group') || node.hasClass('folder')) {
      node.connectedEdges('.meta-edge:visible').forEach(function (me) {
        var isOut = me.source().id() === node.id();
        if (isOut) {
          me.addClass('hl-outgoing');
          if (!isSelectedOrParent(me.target())) me.target().addClass('hl-outgoing');
        } else {
          me.addClass('hl-incoming');
          if (!isSelectedOrParent(me.source())) me.source().addClass('hl-incoming');
        }
        highlighted = highlighted.union(me).union(me.source()).union(me.target());
      });
    }
  }

  selected.forEach(function (node) {
    var isExpandedGroup = node.hasClass('group') && !collapsedGroups.has(node.id());

    node.addClass('hl-selected');
    highlighted = highlighted.union(node);

    // Trace direct edges from this node
    traceEdges(node);

    if (isExpandedGroup) {
      // Include all visible children and their internal edges
      var children = node.children(':visible');
      children.forEach(function (child) {
        highlighted = highlighted.union(child);
      });
      children.connectedEdges(':visible').forEach(function (e) {
        highlighted = highlighted.union(e);
      });

      // Also trace outgoing/incoming from each visible child to external nodes
      children.forEach(function (child) {
        traceEdges(child);
      });
    }
  });

  cy.elements().not(highlighted).addClass('dimmed');
  highlighted.forEach(function (ele) {
    if (ele.isNode() && ele.parent().length > 0) {
      ele.parent().removeClass('dimmed');
    }
  });
}

// --- Build folder tree elements ---
// Walk a FolderTreeNode[] recursively and create cytoscape elements for all
// folders and files. All start hidden; expand logic controls visibility.
function buildFolderElements(elements, treeNodes, groupNodeId, groupId, parentFolderId, maxTime) {
  for (var i = 0; i < treeNodes.length; i++) {
    var tn = treeNodes[i];
    if (tn.type === 'folder') {
      elements.push({
        group: 'nodes',
        data: {
          id: tn.id,
          label: tn.label,
          parent: groupNodeId,
          isFolder: true,
          groupId: groupId,
        },
        classes: 'folder',
      });
      folderState[tn.id] = { children: tn.children, groupId: groupId };
      parentFolderOf[tn.id] = parentFolderId;
      buildFolderElements(elements, tn.children, groupNodeId, groupId, tn.id, maxTime);
    } else {
      // File node — it may already exist from the module creation loop.
      // We record its parentFolder mapping regardless.
      parentFolderOf[tn.moduleURL || tn.id] = parentFolderId;
    }
  }
}

function initGraph(data) {
  var container = document.getElementById('cy');
  var tooltip = document.getElementById('graph-tooltip');

  var elements = [];
  var moduleSet = new Set();
  var groupMap = new Map();

  for (var gi = 0; gi < data.groups.length; gi++) {
    var group = data.groups[gi];
    for (var gmi = 0; gmi < group.modules.length; gmi++) {
      groupMap.set(group.modules[gmi], group);
    }
    if (group.folderTree && group.folderTree.length > 0) {
      groupFolderTrees[group.id] = group.folderTree;
      groupsWithFolderTree.add(group.id);
    }
  }

  var maxTime = 0;
  for (var ti = 0; ti < data.modules.length; ti++) {
    var time = data.modules[ti].loadEndTime - data.modules[ti].resolveStartTime;
    if (time > maxTime) maxTime = time;
  }

  // Compute per-group total time
  var groupTotalTimes = {};
  var seenForGroupTime = {};
  for (var mi = 0; mi < data.modules.length; mi++) {
    var m = data.modules[mi];
    if (seenForGroupTime[m.resolvedURL]) continue;
    seenForGroupTime[m.resolvedURL] = true;
    var g = groupMap.get(m.resolvedURL);
    if (g) {
      var gid = 'group-' + g.id;
      groupTotalTimes[gid] = (groupTotalTimes[gid] || 0) + (m.loadEndTime - m.resolveStartTime);
    }
  }

  // Add group (compound) nodes
  for (var gni = 0; gni < data.groups.length; gni++) {
    var grp = data.groups[gni];
    var groupNodeId = 'group-' + grp.id;
    var groupTime = (groupTotalTimes[groupNodeId] || 0).toFixed(1);
    elements.push({
      group: 'nodes',
      data: {
        id: groupNodeId,
        label: grp.label + ' (' + grp.modules.length + ' modules, ' + groupTime + ' ms)',
        isGroup: true,
        groupId: grp.id,
        moduleCount: grp.modules.length,
        groupTotalTime: groupTotalTimes[groupNodeId] || 0,
      },
      classes: grp.isNodeModules ? 'group node-modules' : 'group',
    });

    // Build folder tree elements for this group
    if (grp.folderTree && grp.folderTree.length > 0) {
      buildFolderElements(elements, grp.folderTree, groupNodeId, grp.id, null, maxTime);
    }
  }

  // Build a set of module URLs that appear in folder trees as files
  // (to set their label from the tree instead of the specifier)
  var folderTreeFileLabels = {};
  function collectFileLabels(treeNodes) {
    for (var i = 0; i < treeNodes.length; i++) {
      var tn = treeNodes[i];
      if (tn.type === 'file' && tn.moduleURL) {
        folderTreeFileLabels[tn.moduleURL] = tn.label;
      } else if (tn.children) {
        collectFileLabels(tn.children);
      }
    }
  }
  for (var gli = 0; gli < data.groups.length; gli++) {
    if (data.groups[gli].folderTree) collectFileLabels(data.groups[gli].folderTree);
  }

  // Track unique modules (first occurrence)
  var seenModules = new Set();
  for (var mni = 0; mni < data.modules.length; mni++) {
    var mod = data.modules[mni];
    if (seenModules.has(mod.resolvedURL)) continue;
    seenModules.add(mod.resolvedURL);

    var modGroup = groupMap.get(mod.resolvedURL);
    var totalTime = mod.loadEndTime - mod.resolveStartTime;
    var timeRatio = maxTime > 0 ? totalTime / maxTime : 0;
    var isBuiltin = mod.resolvedURL.startsWith('node:');

    // Use folder tree label if available
    var label = folderTreeFileLabels[mod.resolvedURL] || mod.specifier;

    elements.push({
      group: 'nodes',
      data: {
        id: mod.resolvedURL,
        label: label,
        parent: modGroup ? 'group-' + modGroup.id : undefined,
        totalTime: totalTime,
        timeRatio: timeRatio,
        fullPath: mod.resolvedURL,
        isBuiltin: isBuiltin,
      },
      classes: isBuiltin ? 'module builtin' : 'module',
    });
    moduleSet.add(mod.resolvedURL);
  }

  // Add edges (deduplicate)
  var edgeSet = new Set();
  for (var eni = 0; eni < data.modules.length; eni++) {
    var eMod = data.modules[eni];
    if (eMod.parentURL && moduleSet.has(eMod.parentURL) && moduleSet.has(eMod.resolvedURL)) {
      var edgeId = eMod.parentURL + '->' + eMod.resolvedURL;
      if (edgeSet.has(edgeId)) continue;
      edgeSet.add(edgeId);

      var isCycleEdge = data.cycles.some(function (cycle) {
        var idx = cycle.modules.indexOf(eMod.parentURL);
        if (idx === -1) return false;
        var nextIdx = (idx + 1) % cycle.modules.length;
        return cycle.modules[nextIdx] === eMod.resolvedURL;
      });

      elements.push({
        group: 'edges',
        data: {
          id: edgeId,
          source: eMod.parentURL,
          target: eMod.resolvedURL,
          specifier: eMod.specifier,
          isCycleEdge: isCycleEdge,
        },
        classes: isCycleEdge ? 'cycle-edge' : '',
      });
    }
  }

  var cy = cytoscape({
    container: container,
    elements: elements,
    style: [
      {
        selector: 'node.group',
        style: {
          'background-color': '#313147',
          'border-color': '#45475a',
          'border-width': 1,
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '11px',
          'color': '#a6adc8',
          'padding': '16px',
          'shape': 'round-rectangle',
          'min-width': '80px',
          'min-height': '30px',
        },
      },
      {
        selector: 'node.group:parent',
        style: {
          'text-valign': 'top',
          'text-margin-y': '-4px',
        },
      },
      {
        selector: 'node.group.collapsed',
        style: {
          'text-valign': 'center',
          'text-halign': 'center',
          'border-width': 2,
          'border-color': '#585b70',
        },
      },
      {
        selector: 'node.group.node-modules',
        style: {
          'background-color': '#282839',
          'border-style': 'dashed',
        },
      },
      {
        selector: 'node.folder',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#3b3b55',
          'border-color': '#585b70',
          'border-width': 1,
          'label': 'data(label)',
          'font-size': '10px',
          'color': '#a6adc8',
          'text-valign': 'center',
          'text-halign': 'center',
          'width': '80px',
          'height': '30px',
        },
      },
      {
        selector: 'node.module',
        style: {
          'label': 'data(label)',
          'font-size': '10px',
          'color': '#cdd6f4',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': '4px',
          'width': function (ele) { return Math.max(16, Math.min(48, 16 + (ele.data('totalTime') / (maxTime || 1)) * 32)); },
          'height': function (ele) { return Math.max(16, Math.min(48, 16 + (ele.data('totalTime') / (maxTime || 1)) * 32)); },
          'background-color': function (ele) {
            var ratio = ele.data('timeRatio') || 0;
            var r = Math.round(ratio < 0.5 ? 166 + ratio * 2 * 87 : 243);
            var g = Math.round(ratio < 0.5 ? 227 : 227 - (ratio - 0.5) * 2 * 87);
            var b = Math.round(ratio < 0.5 ? 161 - ratio * 2 * 50 : 111 - (ratio - 0.5) * 2 * 50);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
          },
          'border-width': 1,
          'border-color': '#45475a',
        },
      },
      {
        selector: 'node.builtin',
        style: {
          'background-color': '#45475a',
          'color': '#6c7086',
          'border-style': 'dashed',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': '#585b70',
          'target-arrow-color': '#585b70',
          'target-arrow-shape': 'triangle',
          'curve-style': 'taxi',
          'taxi-direction': 'downward',
          'taxi-turn': '20px',
          'arrow-scale': 0.7,
        },
      },
      {
        selector: 'edge.meta-edge',
        style: {
          'width': 2,
          'line-color': '#7f849c',
          'target-arrow-color': '#7f849c',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.8,
          'label': 'data(specifier)',
          'font-size': '9px',
          'color': '#6c7086',
          'text-rotation': 'autorotate',
          'text-margin-y': '-8px',
        },
      },
      {
        selector: 'edge.cycle-edge',
        style: {
          'line-color': '#fab387',
          'target-arrow-color': '#fab387',
          'width': 2,
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'edge.cycle-highlight',
        style: {
          'line-color': '#f38ba8',
          'target-arrow-color': '#f38ba8',
          'width': 3,
          'z-index': 10,
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'node.cycle-highlight',
        style: { 'border-color': '#f38ba8', 'border-width': 3 },
      },
      {
        selector: 'node.hl-selected',
        style: { 'border-color': '#cdd6f4', 'border-width': 3 },
      },
      {
        selector: 'node.hl-outgoing',
        style: { 'border-color': '#89b4fa', 'border-width': 3 },
      },
      {
        selector: 'edge.hl-outgoing',
        style: { 'line-color': '#89b4fa', 'target-arrow-color': '#89b4fa', 'width': 2, 'z-index': 5 },
      },
      {
        selector: 'node.hl-incoming',
        style: { 'border-color': '#a6e3a1', 'border-width': 3 },
      },
      {
        selector: 'edge.hl-incoming',
        style: { 'line-color': '#a6e3a1', 'target-arrow-color': '#a6e3a1', 'width': 2, 'z-index': 5 },
      },
      {
        selector: 'node.dimmed',
        style: { 'opacity': 0.2 },
      },
      {
        selector: 'edge.dimmed',
        style: { 'opacity': 0.08 },
      },
      {
        selector: ':selected',
        style: { 'border-color': '#cdd6f4', 'border-width': 3 },
      },
    ],
    layout: { name: 'preset' },
    minZoom: 0.05,
    maxZoom: 5,
  });

  // Collapse all groups then run initial layout
  collapseAll(cy);
  runLayout(cy);

  // Double-click: expand/collapse groups, expand folders
  cy.on('dbltap', 'node', function (e) {
    var node = e.target;
    if (node.hasClass('group')) {
      if (collapsedGroups.has(node.id())) {
        expandGroup(cy, node);
      } else {
        collapseGroup(cy, node);
      }
    } else if (node.hasClass('folder')) {
      expandFolder(cy, node.id());
    }
  });

  // Tooltip handling
  cy.on('mouseover', 'node.module', function (e) {
    var d = e.target.data();
    tooltip.innerHTML =
      '<div class="tooltip-path">' + escapeHtml(d.fullPath) + '</div>' +
      '<div class="tooltip-time">' + d.totalTime.toFixed(2) + ' ms</div>';
    tooltip.style.display = 'block';
  });

  cy.on('mouseover', 'node.folder', function (e) {
    tooltip.innerHTML = '<div class="tooltip-path">' + escapeHtml(e.target.data('label')) + '</div>';
    tooltip.style.display = 'block';
  });

  cy.on('mousemove', 'node.module, node.folder', function (e) {
    var pos = e.renderedPosition || e.position;
    tooltip.style.left = (pos.x + 16) + 'px';
    tooltip.style.top = (pos.y + 16) + 'px';
  });

  cy.on('mouseout', 'node.module, node.folder', function () {
    tooltip.style.display = 'none';
  });

  cy.on('mouseover', 'edge', function (e) {
    tooltip.innerHTML = '<div class="tooltip-path">' + escapeHtml(e.target.data('specifier')) + '</div>';
    tooltip.style.display = 'block';
  });

  cy.on('mousemove', 'edge', function (e) {
    var pos = e.renderedPosition || e.position;
    tooltip.style.left = (pos.x + 16) + 'px';
    tooltip.style.top = (pos.y + 16) + 'px';
  });

  cy.on('mouseout', 'edge', function () {
    tooltip.style.display = 'none';
  });

  // Single click selects (with shift/meta for multi-select)
  cy.on('tap', 'node', function (e) {
    var node = e.target;
    var originalEvent = e.originalEvent;
    var additive = originalEvent && (originalEvent.shiftKey || originalEvent.metaKey || originalEvent.ctrlKey);
    if (!additive) cy.nodes().unselect();
    node.select();
    applySelectionHighlight(cy);
  });

  cy.on('tap', function (e) {
    if (e.target === cy) {
      cy.nodes().unselect();
      clearSelectionHighlight(cy);
      cy.elements().removeClass('cycle-highlight');
    }
  });

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return cy;
}

function highlightCycle(cy, cycle) {
  clearSelectionHighlight(cy);
  cy.elements().removeClass('cycle-highlight');

  // Reveal all cycle members (expand groups + folders)
  for (var k = 0; k < cycle.modules.length; k++) {
    revealModule(cy, cycle.modules[k]);
  }

  var nodes = [];
  for (var i = 0; i < cycle.modules.length; i++) {
    var node = cy.getElementById(cycle.modules[i]);
    if (node.length > 0) {
      node.addClass('cycle-highlight');
      nodes.push(node);
    }

    var nextIdx = (i + 1) % cycle.modules.length;
    var edgeId = cycle.modules[i] + '->' + cycle.modules[nextIdx];
    var edge = cy.getElementById(edgeId);
    if (edge.length > 0) {
      edge.show();
      edge.addClass('cycle-highlight');
    }
  }

  if (nodes.length > 0) {
    var collection = cy.collection();
    for (var j = 0; j < nodes.length; j++) {
      collection = collection.union(nodes[j]);
    }
    cy.animate({ fit: { eles: collection, padding: 60 }, duration: 300 });
  }
}

function clearHighlights(cy) {
  clearSelectionHighlight(cy);
  cy.elements().removeClass('cycle-highlight');
}

function zoomToNode(cy, resolvedURL) {
  var node = cy.getElementById(resolvedURL);
  if (node.length > 0) {
    revealModule(cy, resolvedURL);
    cy.nodes().unselect();
    node.select();
    applySelectionHighlight(cy);
    cy.animate({ center: { eles: node }, zoom: 2, duration: 300 });
  }
}

// Collapse everything, reveal just enough to show the target node,
// relayout, then select and zoom.
function focusOnNode(cy, resolvedURL) {
  var node = cy.getElementById(resolvedURL);
  if (node.length === 0) return;

  // Collapse everything first (without triggering auto-relayout per group)
  var savedAuto = autoRelayout;
  autoRelayout = false;
  collapseAll(cy);
  autoRelayout = savedAuto;

  // Reveal just the target module (expands its group + ancestor folders)
  revealModule(cy, resolvedURL);

  // Relayout, then select and zoom after layout completes
  runLayout(cy, function () {
    cy.nodes().unselect();
    node.select();
    applySelectionHighlight(cy);
    cy.animate({ center: { eles: node }, zoom: 2, duration: 300 });
  });
}

// Search: highlight matching nodes in the graph. If a match is inside a
// collapsed group or folder, highlight that collapsed ancestor instead.
function filterBySearch(cy, query) {
  if (!query) {
    cy.nodes().unselect();
    clearSelectionHighlight(cy);
    return;
  }

  var lowerQuery = query.toLowerCase();
  var toSelect = new Set();

  // Check every module node (visible or not)
  cy.nodes('.module').forEach(function (node) {
    var label = (node.data('label') || '').toLowerCase();
    var path = (node.data('fullPath') || '').toLowerCase();
    if (label.indexOf(lowerQuery) !== -1 || path.indexOf(lowerQuery) !== -1) {
      // Resolve to the nearest visible ancestor
      toSelect.add(resolveVisibleNode(cy, node.id()));
    }
  });

  // Also check folder nodes by label
  cy.nodes('.folder').forEach(function (node) {
    var label = (node.data('label') || '').toLowerCase();
    if (label.indexOf(lowerQuery) !== -1) {
      if (node.visible()) {
        toSelect.add(node.id());
      } else {
        toSelect.add(resolveVisibleNode(cy, node.id()));
      }
    }
  });

  // Select all matching visible nodes
  cy.nodes().unselect();
  toSelect.forEach(function (nodeId) {
    var node = cy.getElementById(nodeId);
    if (node.length > 0 && node.visible()) node.select();
  });
  applySelectionHighlight(cy);
}


