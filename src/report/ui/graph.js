/* global cytoscape, document */

// Web Worker source that runs dagre layout off the main thread.
// It loads dagre via importScripts and computes node positions.
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

  // Extract graph data for the worker
  var nodes = [];
  var edges = [];

  cy.nodes(':visible').forEach(function (node) {
    nodes.push({
      id: node.id(),
      width: node.outerWidth() || 60,
      height: node.outerHeight() || 40,
      parent: node.parent().length > 0 ? node.parent().id() : null,
    });
  });

  cy.edges(':visible').forEach(function (edge) {
    edges.push({
      id: edge.id(),
      source: edge.source().id(),
      target: edge.target().id(),
    });
  });

  var blob = new Blob([DAGRE_WORKER_SRC], { type: 'application/javascript' });
  var url = URL.createObjectURL(blob);
  var worker = new Worker(url);

  worker.onmessage = function (e) {
    var positions = e.data;

    // Apply positions to cytoscape without animation first, then fit
    cy.batch(function () {
      cy.nodes().forEach(function (node) {
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
    // Fallback: run preset layout (nodes stay where they are) and hide overlay
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

function initGraph(data) {
  var container = document.getElementById('cy');
  var tooltip = document.getElementById('graph-tooltip');

  // Build cytoscape elements
  var elements = [];
  var moduleSet = new Set();
  var groupMap = new Map();

  // Create group map for quick lookup
  for (var gi = 0; gi < data.groups.length; gi++) {
    var group = data.groups[gi];
    for (var gmi = 0; gmi < group.modules.length; gmi++) {
      groupMap.set(group.modules[gmi], group);
    }
  }

  // Compute time range for color scaling
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

  // Create cytoscape with no layout initially — we'll run dagre in a worker
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
          'text-valign': 'top',
          'text-halign': 'center',
          'font-size': '11px',
          'color': '#a6adc8',
          'padding': '16px',
          'text-margin-y': '-4px',
          'shape': 'round-rectangle',
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
      {
        selector: 'node.highlight',
        style: {
          'border-color': '#89b4fa',
          'border-width': 3,
        },
      },
      {
        selector: 'node.dimmed',
        style: {
          'opacity': 0.3,
        },
      },
      {
        selector: 'edge.dimmed',
        style: {
          'opacity': 0.15,
        },
      },
      {
        selector: ':selected',
        style: {
          'border-color': '#89b4fa',
          'border-width': 3,
        },
      },
    ],
    // Start with preset (no-op) layout; dagre runs async in worker
    layout: { name: 'preset' },
    minZoom: 0.05,
    maxZoom: 5,
  });

  // Hide builtins before layout so they don't affect positioning
  cy.nodes('.builtin').hide();

  // Run initial layout in worker
  runLayout(cy);

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

  // Click node to highlight connections
  cy.on('tap', 'node.module', function (e) {
    var node = e.target;
    cy.elements().removeClass('dimmed highlight');
    var connected = node.connectedEdges().connectedNodes().union(node).union(node.connectedEdges());
    cy.elements().not(connected).addClass('dimmed');
    node.addClass('highlight');
  });

  cy.on('tap', function (e) {
    if (e.target === cy) {
      cy.elements().removeClass('dimmed highlight cycle-highlight');
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
  cy.elements().removeClass('dimmed highlight cycle-highlight');

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
  cy.elements().removeClass('dimmed highlight cycle-highlight');
}

function zoomToNode(cy, resolvedURL) {
  var node = cy.getElementById(resolvedURL);
  if (node.length > 0) {
    cy.elements().removeClass('dimmed highlight cycle-highlight');
    node.addClass('highlight');
    var connected = node.connectedEdges().connectedNodes().union(node).union(node.connectedEdges());
    cy.elements().not(connected).addClass('dimmed');
    cy.animate({
      center: { eles: node },
      zoom: 2,
      duration: 300,
    });
  }
}

function toggleBuiltins(cy, show) {
  if (show) {
    cy.nodes('.builtin').show();
  } else {
    cy.nodes('.builtin').hide();
  }
}

function filterBySearch(cy, query) {
  if (!query) {
    cy.nodes().show();
    cy.nodes('.builtin').hide();
    return;
  }
  var lowerQuery = query.toLowerCase();
  cy.nodes('.module').forEach(function (node) {
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
    if (node.data('totalTime') < minTime) {
      node.hide();
    } else {
      node.show();
    }
  });
}
