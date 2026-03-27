/* global document */

function initCyclesPanel(data, cy) {
  var cyclesList = document.getElementById('cycles-list');
  var clearBtn = document.getElementById('clear-highlight-btn');
  var panel = document.getElementById('cycles-panel');
  var toggleBtn = document.getElementById('cycles-toggle');
  var activeItem = null;

  if (data.cycles.length === 0) {
    cyclesList.innerHTML = '<div class="no-cycles">No circular dependencies detected</div>';
    clearBtn.style.display = 'none';
    return;
  }

  function getShortName(url) {
    if (url.startsWith('node:')) return url;
    var parts = url.split('/');
    return parts[parts.length - 1] || url;
  }

  for (var i = 0; i < data.cycles.length; i++) {
    (function (cycle, index) {
      var item = document.createElement('div');
      item.className = 'cycle-item';

      var moduleNames = cycle.modules.map(getShortName).join(' \u2192 ');
      item.innerHTML =
        '<div><span class="cycle-length">' + cycle.length + ' modules</span></div>' +
        '<div class="cycle-modules">' + escapeHtml(moduleNames + ' \u2192 ' + getShortName(cycle.modules[0])) + '</div>';

      item.addEventListener('click', function () {
        if (activeItem) activeItem.classList.remove('active');
        activeItem = item;
        item.classList.add('active');
        highlightCycle(cy, cycle);
      });

      cyclesList.appendChild(item);
    })(data.cycles[i], i);
  }

  clearBtn.addEventListener('click', function () {
    if (activeItem) activeItem.classList.remove('active');
    activeItem = null;
    clearHighlights(cy);
  });

  toggleBtn.addEventListener('click', function () {
    panel.classList.toggle('collapsed');
  });

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
