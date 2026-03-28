/* global document */

function initCyclesPanel(data, cy) {
  var cyclesList = document.getElementById('cycles-list');
  var clearBtn = document.getElementById('clear-highlight-btn');
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

  function getFullPath(url) {
    if (url.startsWith('file://')) return url.slice(7);
    return url;
  }

  function copyText(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  for (var i = 0; i < data.cycles.length; i++) {
    (function (cycle, index) {
      var item = document.createElement('div');
      item.className = 'cycle-item';

      var moduleNames = cycle.modules.map(getShortName).join(' \u2192 ');
      item.innerHTML =
        '<div class="cycle-item-header"><span class="cycle-length">' + cycle.length + ' modules</span></div>' +
        '<div class="cycle-modules">' + escapeHtml(moduleNames + ' \u2192 ' + getShortName(cycle.modules[0])) + '</div>';

      var copyBtn = document.createElement('button');
      copyBtn.className = 'cycle-copy-btn';
      copyBtn.title = 'Copy cycle paths';
      copyBtn.textContent = '\u2398';
      copyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var fullPaths = cycle.modules.map(getFullPath);
        fullPaths.push(getFullPath(cycle.modules[0]));
        copyText(fullPaths.join(' \u2192 '));
      });
      item.querySelector('.cycle-item-header').appendChild(copyBtn);

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

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
