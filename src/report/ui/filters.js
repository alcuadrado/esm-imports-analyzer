/* global document */

function initFilters(cy, tableApi) {
  var searchInput = document.getElementById('search-input');
  var builtinsToggle = document.getElementById('show-builtins');
  var thresholdSlider = document.getElementById('time-threshold');
  var thresholdLabel = document.getElementById('threshold-value');

  searchInput.addEventListener('input', function () {
    var query = searchInput.value;
    filterBySearch(cy, query);
    if (tableApi) {
      tableApi.filter(query);
    }
  });

  builtinsToggle.addEventListener('change', function () {
    toggleBuiltins(cy, builtinsToggle.checked);
  });

  thresholdSlider.addEventListener('input', function () {
    var value = Number(thresholdSlider.value);
    thresholdLabel.textContent = value + ' ms';
    filterByThreshold(cy, value);
  });
}
