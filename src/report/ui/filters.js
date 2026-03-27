/* global document */

function initFilters(cy, tableApi) {
  var searchInput = document.getElementById('search-input');
  var thresholdSlider = document.getElementById('time-threshold');
  var thresholdLabel = document.getElementById('threshold-value');

  searchInput.addEventListener('input', function () {
    var query = searchInput.value;
    filterBySearch(cy, query);
    if (tableApi) {
      tableApi.filter(query);
    }
  });

  thresholdSlider.addEventListener('input', function () {
    var value = Number(thresholdSlider.value);
    thresholdLabel.textContent = value + ' ms';
    filterByThreshold(cy, value);
  });
}
