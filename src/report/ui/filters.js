/* global document */

function initFilters(cy, tableApi) {
  var searchInput = document.getElementById('search-input');

  searchInput.addEventListener('input', function () {
    var query = searchInput.value;
    filterBySearch(cy, query);
    if (tableApi) {
      tableApi.filter(query);
    }
  });
}
