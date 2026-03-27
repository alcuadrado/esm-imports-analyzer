/* global document */

function initTable(data, cy) {
  var tableBody = document.getElementById('table-body');
  var maxTime = 0;

  // Build flat list of unique modules with timing
  var seen = {};
  var allModules = [];
  for (var i = 0; i < data.modules.length; i++) {
    var mod = data.modules[i];
    if (seen[mod.resolvedURL]) continue;
    seen[mod.resolvedURL] = true;
    allModules.push({
      url: mod.resolvedURL,
      specifier: mod.specifier,
      totalTime: mod.loadEndTime - mod.resolveStartTime,
    });
    var t = mod.loadEndTime - mod.resolveStartTime;
    if (t > maxTime) maxTime = t;
  }

  // Sort by total time descending, take top 20
  allModules.sort(function (a, b) { return b.totalTime - a.totalTime; });
  var topModules = allModules.slice(0, 20);

  function getTimeColor(time) {
    if (maxTime === 0) return '#a6e3a1';
    var ratio = time / maxTime;
    if (ratio < 0.33) return '#a6e3a1';
    if (ratio < 0.66) return '#f9e2af';
    return '#f38ba8';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderTable() {
    tableBody.innerHTML = '';
    for (var i = 0; i < topModules.length; i++) {
      var mod = topModules[i];
      var row = document.createElement('div');
      row.className = 'table-row';
      row.dataset.url = mod.url;

      var timeColor = getTimeColor(mod.totalTime);
      var barWidth = maxTime > 0 ? Math.max(2, (mod.totalTime / maxTime) * 60) : 2;

      row.innerHTML =
        '<div class="module-name">' +
          '<span class="module-label" title="' + escapeAttr(mod.url) + '">' + escapeHtml(mod.specifier) + '</span>' +
        '</div>' +
        '<div class="time-value">' +
          '<span class="time-bar" style="width: ' + barWidth + 'px; background: ' + timeColor + '"></span>' +
          mod.totalTime.toFixed(2) + ' ms' +
        '</div>';

      tableBody.appendChild(row);

      (function (moduleUrl, rowEl) {
        rowEl.addEventListener('click', function () {
          if (cy) focusOnNode(cy, moduleUrl);
          var rows = document.querySelectorAll('.table-row');
          for (var j = 0; j < rows.length; j++) {
            rows[j].classList.remove('highlighted');
          }
          rowEl.classList.add('highlighted');
        });
      })(mod.url, row);
    }
  }

  renderTable();

  return {
    filter: function (query) {
      var rows = tableBody.querySelectorAll('.table-row');
      var lowerQuery = query.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        var url = (rows[i].dataset.url || '').toLowerCase();
        var text = rows[i].textContent.toLowerCase();
        if (!query || url.indexOf(lowerQuery) !== -1 || text.indexOf(lowerQuery) !== -1) {
          rows[i].style.display = '';
        } else {
          rows[i].style.display = 'none';
        }
      }
    },
    rerender: renderTable,
  };
}
