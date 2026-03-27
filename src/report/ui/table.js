/* global document */

function initTable(data, cy) {
  var tableBody = document.getElementById('table-body');
  var countInput = document.getElementById('slowest-count');
  var maxTime = 0;

  // Compute max time for bar widths
  for (var i = 0; i < data.modules.length; i++) {
    var t = (data.modules[i].resolveEndTime - data.modules[i].resolveStartTime) + (data.modules[i].loadEndTime - data.modules[i].loadStartTime);
    if (t > maxTime) maxTime = t;
  }

  // Build URL -> ModuleNode index from the full tree
  var nodeByURL = {};
  function indexTree(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      nodeByURL[nodes[i].resolvedURL] = nodes[i];
      indexTree(nodes[i].children);
    }
  }
  indexTree(data.tree);

  // Pre-sort all unique modules by time descending
  var allSlowest = [];
  var seen = {};
  var modulesCopy = data.modules.slice().sort(function (a, b) {
    return ((b.resolveEndTime - b.resolveStartTime) + (b.loadEndTime - b.loadStartTime)) - ((a.resolveEndTime - a.resolveStartTime) + (a.loadEndTime - a.loadStartTime));
  });
  for (var i = 0; i < modulesCopy.length; i++) {
    var url = modulesCopy[i].resolvedURL;
    if (!seen[url] && nodeByURL[url]) {
      seen[url] = true;
      allSlowest.push(nodeByURL[url]);
    }
  }

  function buildRoots(count) {
    return allSlowest.slice(0, count);
  }

  var currentSort = { column: 'time', direction: 'desc' };

  function getTimeColor(time) {
    if (maxTime === 0) return '#a6e3a1';
    var ratio = time / maxTime;
    if (ratio < 0.33) return '#a6e3a1';
    if (ratio < 0.66) return '#f9e2af';
    return '#f38ba8';
  }

  function getDisplayPath(url) {
    if (url.startsWith('file://')) return url.slice(7);
    return url;
  }

  function countAllChildren(node) {
    var count = node.children.length;
    for (var i = 0; i < node.children.length; i++) {
      count += countAllChildren(node.children[i]);
    }
    return count;
  }

  function renderRow(node, depth, parentElement) {
    var row = document.createElement('div');
    row.className = 'table-row';
    row.dataset.url = node.resolvedURL;
    row.dataset.depth = depth;

    var hasChildren = node.children.length > 0;
    var indent = depth * 20;
    var childCount = countAllChildren(node);

    var timeColor = getTimeColor(node.totalTime);
    var barWidth = maxTime > 0 ? Math.max(2, (node.totalTime / maxTime) * 60) : 2;

    row.innerHTML =
      '<div class="module-name" style="padding-left: ' + indent + 'px">' +
        '<span class="chevron' + (hasChildren ? '' : ' empty') + '">' + (hasChildren ? '\u25B6' : '') + '</span>' +
        '<span class="module-label" title="' + escapeAttr(node.resolvedURL) + '">' + escapeHtml(depth === 0 ? getDisplayPath(node.resolvedURL) : node.specifier) + '</span>' +
      '</div>' +
      '<div class="time-value">' +
        '<span class="time-bar" style="width: ' + barWidth + 'px; background: ' + timeColor + '"></span>' +
        node.totalTime.toFixed(2) + ' ms' +
      '</div>' +
      '<div class="imports-count">' + childCount + '</div>';

    parentElement.appendChild(row);

    // Click to zoom in graph
    row.addEventListener('click', function (e) {
      if (e.target.classList.contains('chevron')) return;
      if (cy) {
        focusOnNode(cy, node.resolvedURL);
      }
      // Highlight this row
      var rows = document.querySelectorAll('.table-row');
      for (var j = 0; j < rows.length; j++) {
        rows[j].classList.remove('highlighted');
      }
      row.classList.add('highlighted');
    });

    // Expand/collapse children
    if (hasChildren) {
      var expanded = false;
      var childContainer = document.createElement('div');
      childContainer.className = 'child-container';
      childContainer.style.display = 'none';
      parentElement.appendChild(childContainer);

      var chevron = row.querySelector('.chevron');
      chevron.addEventListener('click', function () {
        expanded = !expanded;
        chevron.classList.toggle('expanded', expanded);
        childContainer.style.display = expanded ? 'block' : 'none';

        if (expanded && childContainer.children.length === 0) {
          var sortedChildren = sortNodes(node.children, currentSort);
          for (var k = 0; k < sortedChildren.length; k++) {
            renderRow(sortedChildren[k], depth + 1, childContainer);
          }
        }
      });
    }
  }

  function sortNodes(nodes, sort) {
    var sorted = nodes.slice();
    sorted.sort(function (a, b) {
      var cmp = 0;
      if (sort.column === 'time') {
        cmp = a.totalTime - b.totalTime;
      } else if (sort.column === 'name') {
        cmp = a.specifier.localeCompare(b.specifier);
      } else if (sort.column === 'imports') {
        cmp = countAllChildren(a) - countAllChildren(b);
      }
      return sort.direction === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }

  function renderTable() {
    tableBody.innerHTML = '';
    var count = parseInt(countInput.value, 10) || 20;
    var roots = sortNodes(buildRoots(count), currentSort);
    for (var i = 0; i < roots.length; i++) {
      renderRow(roots[i], 0, tableBody);
    }
  }

  // Count input change
  countInput.addEventListener('input', function () {
    renderTable();
  });

  // Column sorting
  document.querySelectorAll('.table-header-row span[data-sort]').forEach(function (header) {
    header.addEventListener('click', function () {
      var col = header.dataset.sort;
      if (currentSort.column === col) {
        currentSort.direction = currentSort.direction === 'desc' ? 'asc' : 'desc';
      } else {
        currentSort.column = col;
        currentSort.direction = 'desc';
      }
      // Update sort arrows
      document.querySelectorAll('.sort-arrow').forEach(function (arrow) {
        arrow.textContent = '';
      });
      var arrow = header.querySelector('.sort-arrow');
      if (arrow) {
        arrow.textContent = currentSort.direction === 'desc' ? ' \u25BC' : ' \u25B2';
      }
      renderTable();
    });
  });

  renderTable();

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    filter: function (query) {
      // Only filter top-level rows (depth 0), not expanded children
      var rows = tableBody.querySelectorAll('.table-row[data-depth="0"]');
      var lowerQuery = query.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        var url = (rows[i].dataset.url || '').toLowerCase();
        var text = rows[i].textContent.toLowerCase();
        var match = !query || url.indexOf(lowerQuery) !== -1 || text.indexOf(lowerQuery) !== -1;
        // Hide/show the row and its sibling child-container
        rows[i].style.display = match ? '' : 'none';
        var next = rows[i].nextElementSibling;
        if (next && next.classList.contains('child-container')) {
          next.style.display = match ? next.style.display : 'none';
        }
      }
    },
    rerender: renderTable,
  };
}
