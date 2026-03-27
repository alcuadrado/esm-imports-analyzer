/* global cytoscape, document, window */

function initGraph(data) {
  const container = document.getElementById('cy');
  const tooltip = document.getElementById('graph-tooltip');

  // Build cytoscape elements
  const elements = [];
  const moduleSet = new Set();
  const groupMap = new Map();

  // Create group map for quick lookup
  for (const group of data.groups) {
    for (const moduleURL of group.modules) {
      groupMap.set(moduleURL, group);
    }
  }

  // Compute time range for color scaling
  let maxTime = 0;
  for (const mod of data.modules) {
    const time = mod.loadEndTime - mod.resolveStartTime;
    if (time > maxTime) maxTime = time;
  }

  // Compute per-group total time and edge counts
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

  // Count inter-group edges
  var groupEdgeCounts = {};
  for (var ei = 0; ei < data.modules.length; ei++) {
    var em = data.modules[ei];
    if (em.parentURL) {
      var srcGroup = groupMap.get(em.parentURL);
      var tgtGroup = groupMap.get(em.resolvedURL);
      if (srcGroup && tgtGroup && srcGroup.id !== tgtGroup.id) {
        var sgid = 'group-' + srcGroup.id;
        var tgid = 'group-' + tgtGroup.id;
        groupEdgeCounts[sgid] = (groupEdgeCounts[sgid] || 0) + 1;
        groupEdgeCounts[tgid] = (groupEdgeCounts[tgid] || 0) + 1;
      }
    }
  }

  // Add group (compound) nodes
  for (const group of data.groups) {
    var groupNodeId = 'group-' + group.id;
    var groupTime = (groupTotalTimes[groupNodeId] || 0).toFixed(1);
    var edgeCount = groupEdgeCounts[groupNodeId] || 0;
    elements.push({
      group: 'nodes',
      data: {
        id: groupNodeId,
        label: group.label + ' (' + group.modules.length + ' modules, ' + groupTime + ' ms, ' + edgeCount + ' edges)',
        isGroup: true,
        groupId: group.id,
        moduleCount: group.modules.length,
        groupTotalTime: groupTotalTimes[groupNodeId] || 0,
        groupEdgeCount: edgeCount,
      },
      classes: group.isNodeModules ? 'group node-modules' : 'group',
    });
  }

  // Track unique modules (first occurrence)
  const seenModules = new Set();
  for (const mod of data.modules) {
    if (seenModules.has(mod.resolvedURL)) continue;
    seenModules.add(mod.resolvedURL);

    const group = groupMap.get(mod.resolvedURL);
    const totalTime = mod.loadEndTime - mod.resolveStartTime;
    const timeRatio = maxTime > 0 ? totalTime / maxTime : 0;
    const isBuiltin = mod.resolvedURL.startsWith('node:');

    elements.push({
      group: 'nodes',
      data: {
        id: mod.resolvedURL,
        label: mod.specifier,
        parent: group ? 'group-' + group.id : undefined,
        totalTime: totalTime,
        timeRatio: timeRatio,
        fullPath: mod.resolvedURL,
        isBuiltin: isBuiltin,
      },
      classes: isBuiltin ? 'module builtin' : 'module',
    });
    moduleSet.add(mod.resolvedURL);
  }

  // Add edges
  for (const mod of data.modules) {
    if (mod.parentURL && moduleSet.has(mod.parentURL) && moduleSet.has(mod.resolvedURL)) {
      const isCycleEdge = data.cycles.some(function (cycle) {
        const idx = cycle.modules.indexOf(mod.parentURL);
        if (idx === -1) return false;
        const nextIdx = (idx + 1) % cycle.modules.length;
        return cycle.modules[nextIdx] === mod.resolvedURL;
      });

      elements.push({
        group: 'edges',
        data: {
          id: mod.parentURL + '->' + mod.resolvedURL,
          source: mod.parentURL,
          target: mod.resolvedURL,
          specifier: mod.specifier,
          isCycleEdge: isCycleEdge,
        },
        classes: isCycleEdge ? 'cycle-edge' : '',
      });
    }
  }

  const cy = cytoscape({
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
          'width': 'mapData(totalTime, 0, ' + maxTime + ', 16, 48)',
          'height': 'mapData(totalTime, 0, ' + maxTime + ', 16, 48)',
          'background-color': 'mapData(timeRatio, 0, 1, #a6e3a1, #f38ba8)',
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
          'line-color': '#45475a',
          'target-arrow-color': '#45475a',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.7,
        },
      },
      {
        selector: 'edge.cycle-edge',
        style: {
          'line-color': '#fab387',
          'target-arrow-color': '#fab387',
          'width': 2,
        },
      },
      {
        selector: 'edge.cycle-highlight',
        style: {
          'line-color': '#f38ba8',
          'target-arrow-color': '#f38ba8',
          'width': 3,
          'z-index': 10,
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
    layout: {
      name: 'cose-bilkent',
      animate: false,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: 80,
      nodeRepulsion: 8000,
      edgeElasticity: 0.1,
      nestingFactor: 0.3,
      gravity: 0.2,
      tile: true,
      tilingPaddingVertical: 16,
      tilingPaddingHorizontal: 16,
    },
    minZoom: 0.1,
    maxZoom: 5,
  });

  // Initialize expand-collapse extension
  var expandCollapseApi = null;
  if (typeof cytoscapeExpandCollapse === 'function') {
    cytoscape.use(cytoscapeExpandCollapse);
    expandCollapseApi = cy.expandCollapse({
      layoutBy: {
        name: 'cose-bilkent',
        animate: false,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 80,
        nodeRepulsion: 8000,
      },
      fisheye: false,
      animate: false,
      undoable: false,
      cueEnabled: true,
    });
    // Collapse all groups by default
    expandCollapseApi.collapseAll();
  }

  // Double-click to expand/collapse groups
  cy.on('dbltap', 'node.group', function (e) {
    var node = e.target;
    if (expandCollapseApi) {
      if (node.hasClass('cy-expand-collapse-collapsed-node')) {
        expandCollapseApi.expand(node);
      } else {
        expandCollapseApi.collapse(node);
      }
    }
  });

  // Tooltip handling
  cy.on('mouseover', 'node.module', function (e) {
    const node = e.target;
    const d = node.data();
    tooltip.innerHTML =
      '<div class="tooltip-path">' + escapeHtml(d.fullPath) + '</div>' +
      '<div class="tooltip-time">' + d.totalTime.toFixed(2) + ' ms</div>';
    tooltip.style.display = 'block';
  });

  cy.on('mousemove', 'node.module', function (e) {
    const pos = e.renderedPosition || e.position;
    tooltip.style.left = (pos.x + 16) + 'px';
    tooltip.style.top = (pos.y + 16) + 'px';
  });

  cy.on('mouseout', 'node.module', function () {
    tooltip.style.display = 'none';
  });

  cy.on('mouseover', 'edge', function (e) {
    const edge = e.target;
    tooltip.innerHTML = '<div class="tooltip-path">' + escapeHtml(edge.data('specifier')) + '</div>';
    tooltip.style.display = 'block';
  });

  cy.on('mousemove', 'edge', function (e) {
    const pos = e.renderedPosition || e.position;
    tooltip.style.left = (pos.x + 16) + 'px';
    tooltip.style.top = (pos.y + 16) + 'px';
  });

  cy.on('mouseout', 'edge', function () {
    tooltip.style.display = 'none';
  });

  // Click node to highlight connections
  cy.on('tap', 'node.module', function (e) {
    const node = e.target;
    cy.elements().removeClass('dimmed');
    const connected = node.connectedEdges().connectedNodes().union(node).union(node.connectedEdges());
    cy.elements().not(connected).addClass('dimmed');
    node.addClass('highlight');
  });

  cy.on('tap', function (e) {
    if (e.target === cy) {
      cy.elements().removeClass('dimmed highlight cycle-highlight');
    }
  });

  // Hide builtins by default
  cy.nodes('.builtin').hide();

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return cy;
}

function highlightCycle(cy, cycle) {
  cy.elements().removeClass('dimmed highlight cycle-highlight');

  // Expand any groups containing cycle members
  var api = cy.expandCollapse ? cy.expandCollapse('get') : null;
  if (api) {
    for (var k = 0; k < cycle.modules.length; k++) {
      var n = cy.getElementById(cycle.modules[k]);
      if (n.length > 0 && n.parent().length > 0) {
        var parentNode = n.parent();
        if (parentNode.hasClass('cy-expand-collapse-collapsed-node')) {
          api.expand(parentNode);
        }
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
      edge.addClass('cycle-highlight');
    }
  }

  // Zoom to fit the cycle
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
