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
// Track which groups are collapsed. Key = group node id, value = true if collapsed.
var collapsedGroups = new Set();

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

  // Extract visible graph data for the worker
  var nodes = [];
  var edges = [];
  var visibleNodeIds = new Set();
  // Track which visible group nodes are expanded (have visible children).
  // Expanded groups should NOT be sent as dagre nodes — cytoscape auto-sizes
  // them to wrap their children.  Only collapsed groups act as leaf nodes.
  var expandedGroupIds = new Set();

  cy.nodes(':visible').forEach(function (node) {
    var isGroup = node.hasClass('group');
    if (isGroup && !collapsedGroups.has(node.id())) {
      // Expanded group — skip it; dagre will use it only as a compound parent
      expandedGroupIds.add(node.id());
      visibleNodeIds.add(node.id());
      return;
    }
    visibleNodeIds.add(node.id());
    // For child nodes inside an expanded group, tell dagre about the parent
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

  // Also add expanded groups as dagre compound parents (no width/height — dagre
  // will size them from their children)
  expandedGroupIds.forEach(function (gid) {
    nodes.push({
      id: gid,
      width: 0,
      height: 0,
      parent: null,
      isCompound: true,
    });
  });

  cy.edges(':visible').forEach(function (edge) {
    if (visibleNodeIds.has(edge.source().id()) && visibleNodeIds.has(edge.target().id())) {
      edges.push({
        id: edge.id(),
        source: edge.source().id(),
        target: edge.target().id(),
      });
    }
  });

  var blob = new Blob([DAGRE_WORKER_SRC], { type: 'application/javascript' });
  var url = URL.createObjectURL(blob);
  var worker = new Worker(url);

  worker.onmessage = function (e) {
    var positions = e.data;
    cy.batch(function () {
      cy.nodes().forEach(function (node) {
        // Never set position on expanded group nodes — let cytoscape auto-size
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

  worker.postMessage({
    nodes: nodes,
    edges: edges,
    rankDir: 'TB',
    nodeSep: 40,
    edgeSep: 10,
    rankSep: 60,
  });
}

// Recompute which edges are visible and create/remove meta-edges between
// collapsed groups.  Call after any collapse/expand change.
function refreshEdgeVisibility(cy) {
  cy.batch(function () {
    // Remove old meta-edges
    cy.edges('.meta-edge').remove();

    // Decide visibility for every real edge and collect meta-edge needs
    var metaEdges = {};  // key "srcGroup->tgtGroup", value { source, target, count }

    cy.edges().forEach(function (edge) {
      var src = edge.source();
      var tgt = edge.target();
      var srcGroup = src.parent().length > 0 ? src.parent() : null;
      var tgtGroup = tgt.parent().length > 0 ? tgt.parent() : null;
      var srcCollapsed = srcGroup && collapsedGroups.has(srcGroup.id());
      var tgtCollapsed = tgtGroup && collapsedGroups.has(tgtGroup.id());

      if (!srcCollapsed && !tgtCollapsed) {
        // Both endpoints visible — show the real edge if endpoints are visible
        if (src.visible() && tgt.visible()) {
          edge.show();
        } else {
          edge.hide();
        }
        return;
      }

      // At least one side collapsed — hide the real edge, need a meta-edge
      edge.hide();

      var effectiveSrc = srcCollapsed ? srcGroup.id() : src.id();
      var effectiveTgt = tgtCollapsed ? tgtGroup.id() : tgt.id();

      // Skip self-loops on the same collapsed group
      if (effectiveSrc === effectiveTgt) return;

      var key = effectiveSrc + '||' + effectiveTgt;
      if (!metaEdges[key]) {
        metaEdges[key] = { source: effectiveSrc, target: effectiveTgt, count: 0 };
      }
      metaEdges[key].count++;
    });

    // Add meta-edges
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

// Collapse a group: hide its children, refresh edges
function collapseGroup(cy, groupNode) {
  collapsedGroups.add(groupNode.id());
  groupNode.addClass('collapsed');
  cy.batch(function () {
    groupNode.children().hide();
  });
  refreshEdgeVisibility(cy);
}

// Expand a group: show its children, refresh edges
function expandGroup(cy, groupNode) {
  collapsedGroups.delete(groupNode.id());
  groupNode.removeClass('collapsed');
  cy.batch(function () {
    groupNode.children().forEach(function (child) {
      if (child.hasClass('builtin') && !document.getElementById('show-builtins').checked) return;
      child.show();
    });
  });
  refreshEdgeVisibility(cy);
}

function collapseAll(cy) {
  cy.nodes('.group').forEach(function (groupNode) {
    collapsedGroups.add(groupNode.id());
    groupNode.addClass('collapsed');
  });
  cy.batch(function () {
    cy.nodes('.group').forEach(function (groupNode) {
      groupNode.children().hide();
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

  // Clear previous highlight classes (but keep :selected state)
  for (var i = 0; i < HL_CLASSES.length; i++) {
    cy.elements().removeClass(HL_CLASSES[i]);
  }

  var highlighted = cy.collection();

  selected.forEach(function (node) {
    node.addClass('hl-selected');
    highlighted = highlighted.union(node);

    // Outgoing: edges where this node is the source, and their targets
    var outEdges = node.outgoers('edge:visible');
    outEdges.addClass('hl-outgoing');
    highlighted = highlighted.union(outEdges);
    outEdges.targets().forEach(function (t) {
      if (!t.hasClass('hl-selected')) t.addClass('hl-outgoing');
      highlighted = highlighted.union(t);
    });

    // Incoming: edges where this node is the target, and their sources
    var inEdges = node.incomers('edge:visible');
    inEdges.addClass('hl-incoming');
    highlighted = highlighted.union(inEdges);
    inEdges.sources().forEach(function (s) {
      if (!s.hasClass('hl-selected') && !s.hasClass('hl-outgoing')) s.addClass('hl-incoming');
      highlighted = highlighted.union(s);
    });

    // For group nodes: also follow meta-edges
    if (node.hasClass('group')) {
      node.connectedEdges('.meta-edge:visible').forEach(function (me) {
        var isOut = me.source().id() === node.id();
        if (isOut) {
          me.addClass('hl-outgoing');
          if (!me.target().hasClass('hl-selected')) me.target().addClass('hl-outgoing');
        } else {
          me.addClass('hl-incoming');
          if (!me.source().hasClass('hl-selected')) me.source().addClass('hl-incoming');
        }
        highlighted = highlighted.union(me).union(me.source()).union(me.target());
      });
    }
  });

  // Dim everything not highlighted
  cy.elements().not(highlighted).addClass('dimmed');
  // Don't dim parent groups of highlighted children
  highlighted.forEach(function (ele) {
    if (ele.isNode() && ele.parent().length > 0) {
      ele.parent().removeClass('dimmed');
    }
  });
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

    elements.push({
      group: 'nodes',
      data: {
        id: mod.resolvedURL,
        label: mod.specifier,
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
        // When expanded, label goes to top
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
        style: {
          'border-color': '#f38ba8',
          'border-width': 3,
        },
      },
      // Selection highlighting — directional
      {
        selector: 'node.hl-selected',
        style: {
          'border-color': '#cdd6f4',
          'border-width': 3,
        },
      },
      {
        selector: 'node.hl-outgoing',
        style: {
          'border-color': '#89b4fa',
          'border-width': 3,
        },
      },
      {
        selector: 'edge.hl-outgoing',
        style: {
          'line-color': '#89b4fa',
          'target-arrow-color': '#89b4fa',
          'width': 2,
          'z-index': 5,
        },
      },
      {
        selector: 'node.hl-incoming',
        style: {
          'border-color': '#a6e3a1',
          'border-width': 3,
        },
      },
      {
        selector: 'edge.hl-incoming',
        style: {
          'line-color': '#a6e3a1',
          'target-arrow-color': '#a6e3a1',
          'width': 2,
          'z-index': 5,
        },
      },
      {
        selector: 'node.dimmed',
        style: {
          'opacity': 0.2,
        },
      },
      {
        selector: 'edge.dimmed',
        style: {
          'opacity': 0.08,
        },
      },
      {
        selector: ':selected',
        style: {
          'border-color': '#cdd6f4',
          'border-width': 3,
        },
      },
    ],
    layout: { name: 'preset' },
    minZoom: 0.05,
    maxZoom: 5,
  });

  // Hide builtins, then collapse all groups, then run initial layout
  cy.nodes('.builtin').hide();
  collapseAll(cy);
  runLayout(cy);

  // Double-click group to toggle expand/collapse
  cy.on('dbltap', 'node.group', function (e) {
    var groupNode = e.target;
    if (collapsedGroups.has(groupNode.id())) {
      expandGroup(cy, groupNode);
    } else {
      collapseGroup(cy, groupNode);
    }
  });

  // Tooltip handling
  cy.on('mouseover', 'node.module', function (e) {
    var node = e.target;
    var d = node.data();
    tooltip.innerHTML =
      '<div class="tooltip-path">' + escapeHtml(d.fullPath) + '</div>' +
      '<div class="tooltip-time">' + d.totalTime.toFixed(2) + ' ms</div>';
    tooltip.style.display = 'block';
  });

  cy.on('mousemove', 'node.module', function (e) {
    var pos = e.renderedPosition || e.position;
    tooltip.style.left = (pos.x + 16) + 'px';
    tooltip.style.top = (pos.y + 16) + 'px';
  });

  cy.on('mouseout', 'node.module', function () {
    tooltip.style.display = 'none';
  });

  cy.on('mouseover', 'edge', function (e) {
    var edge = e.target;
    tooltip.innerHTML = '<div class="tooltip-path">' + escapeHtml(edge.data('specifier')) + '</div>';
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

    if (!additive) {
      cy.nodes().unselect();
    }
    node.select();
    applySelectionHighlight(cy);
  });

  // Click background to clear
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

  // Expand groups containing cycle members so they become visible
  for (var k = 0; k < cycle.modules.length; k++) {
    var cn = cy.getElementById(cycle.modules[k]);
    if (cn.length > 0 && cn.parent().length > 0) {
      var parentNode = cn.parent();
      if (collapsedGroups.has(parentNode.id())) {
        expandGroup(cy, parentNode);
      }
    }
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
    cy.animate({
      fit: { eles: collection, padding: 60 },
      duration: 300,
    });
  }
}

function clearHighlights(cy) {
  clearSelectionHighlight(cy);
  cy.elements().removeClass('cycle-highlight');
}

function zoomToNode(cy, resolvedURL) {
  var node = cy.getElementById(resolvedURL);
  if (node.length > 0) {
    // Expand parent group if collapsed
    if (node.parent().length > 0 && collapsedGroups.has(node.parent().id())) {
      expandGroup(cy, node.parent());
    }
    cy.nodes().unselect();
    node.select();
    applySelectionHighlight(cy);
    cy.animate({
      center: { eles: node },
      zoom: 2,
      duration: 300,
    });
  }
}

function toggleBuiltins(cy, show) {
  if (show) {
    cy.nodes('.builtin').forEach(function (node) {
      // Only show if parent group is expanded
      if (node.parent().length === 0 || !collapsedGroups.has(node.parent().id())) {
        node.show();
      }
    });
  } else {
    cy.nodes('.builtin').hide();
  }
}

function filterBySearch(cy, query) {
  if (!query) {
    cy.nodes('.module').forEach(function (node) {
      // Respect collapsed state
      if (node.parent().length > 0 && collapsedGroups.has(node.parent().id())) return;
      if (node.hasClass('builtin') && !document.getElementById('show-builtins').checked) return;
      node.show();
    });
    return;
  }
  var lowerQuery = query.toLowerCase();
  cy.nodes('.module').forEach(function (node) {
    if (node.parent().length > 0 && collapsedGroups.has(node.parent().id())) return;
    var label = (node.data('label') || '').toLowerCase();
    var path = (node.data('fullPath') || '').toLowerCase();
    if (label.indexOf(lowerQuery) !== -1 || path.indexOf(lowerQuery) !== -1) {
      node.show();
    } else {
      node.hide();
    }
  });
}

function filterByThreshold(cy, minTime) {
  cy.nodes('.module').forEach(function (node) {
    if (node.parent().length > 0 && collapsedGroups.has(node.parent().id())) return;
    if (node.data('totalTime') < minTime) {
      node.hide();
    } else {
      if (node.hasClass('builtin') && !document.getElementById('show-builtins').checked) return;
      node.show();
    }
  });
}
