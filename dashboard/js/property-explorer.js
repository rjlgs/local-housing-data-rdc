/**
 * Property Explorer tab — search and compare individual sold homes.
 * Includes a Leaflet map with polygon drawing for spatial filtering.
 */

const PropertyExplorer = {
  _filteredHomes: [],
  _allHomes: [],
  _sort: { col: 'sold_date', asc: false },
  _selectedTypes: new Set(),
  _typeOptions: [
    { value: 'Single Family Residential', label: 'Single Family' },
    { value: 'Townhouse', label: 'Townhouse' },
    { value: 'Condo/Co-op', label: 'Condo' },
  ],
  _map: null,
  _markersLayer: null,
  _drawnItems: null,
  _drawControl: null,
  _areaPolygonsLayer: null,
  _customPolygon: null,
  _selectedAreas: new Set(),
  _markersByAddr: {},
  _photoTooltip: null,
  _photoTimeout: { id: null },
  _compMap: null,
  _compMarkersByAddr: {},

  _headers: [
    { col: 'sold_date', label: 'Sold' },
    { col: 'visual_quality', label: 'VQ' },
    { col: 'address', label: 'Address' },
    { col: 'city', label: 'City' },
    { col: 'neighborhood', label: 'Neighborhood' },
    { col: 'sale_price', label: 'Price' },
    { col: 'hoa_monthly', label: 'HOA/mo' },
    { col: 'price_per_sqft', label: '$/SqFt' },
    { col: 'sqft', label: 'SqFt' },
    { col: 'beds', label: 'Bd' },
    { col: 'baths', label: 'Ba' },
    { col: 'year_built', label: 'Year' },
  ],

  init(container, data) {
    this._allHomes = data.sold_homes;
    this._metro = data.config.metro || {};
    this._focusAreas = data.config.focus_areas;
    const focusAreas = this._focusAreas;

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>Sold</h2>
          <button id="pe-learn-more" class="btn-learn-more" aria-label="Learn more about property explorer" title="Learn more">&#9432;</button>
          ${data.data_freshness && data.data_freshness.sold_homes ? `<span class="freshness-badge">Sold data updated ${MapUtils.formatAge(data.data_freshness.sold_homes)}</span>` : ''}
        </div>
        <p class="subtitle">Search recent sales. Filter by area, size, and price. Draw a polygon on the map to define a custom area.</p>
      </div>
      <div id="pe-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="pe-modal-close">&times;</button>
          <h3>About Property Explorer Data</h3>
          <p>Property Explorer shows <strong>individual recently sold homes</strong> pulled from Redfin's sold listings API. By default, this covers the last ~90 days of sales across ${data.config.focus_areas.length} focus areas in the ${this._metro.name || ''} metro.</p>
          <h4>Filtering</h4>
          <p>Use the dropdown filters to narrow by area, bedrooms, bathrooms, square footage, price, and property type. For areas with polygon boundaries (like Irving Park and Sunset Hills), filtering uses <strong>spatial matching</strong> — a home is included only if its coordinates fall within the defined boundary.</p>
          <h4>Custom polygon drawing</h4>
          <p>Select <strong>"Custom (Draw on Map)"</strong> from the Area dropdown to draw your own polygon or rectangle on the map. All homes inside your shape will be filtered and analyzed with summary statistics.</p>
          <h4>Comparable sales</h4>
          <p>Click any row to see comparable sales — homes in the same zip code with similar bed count (&plusmn;1) and square footage (&plusmn;25%). The comp analysis shows how the sale price compares to the median of comparable recent sales.</p>
          <h4>Data sources</h4>
          <ul>
            <li><strong>Sale data:</strong> Redfin sold listings API (last ~90 days)</li>
          </ul>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-cluster">
          <div class="filter-cluster-label">Area</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <div id="pe-area-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="pe-area-trigger">
                  <span class="multiselect-label">All Areas</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="pe-area-dropdown">
                  <div class="multiselect-options" id="pe-area-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Beds</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-beds-min" placeholder="2" min="0" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-beds-max" placeholder="5" min="0" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Baths</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-baths-min" placeholder="2" min="0" step="0.5"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-baths-max" placeholder="4" min="0" step="0.5"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Sq Ft</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-sqft-min" placeholder="1500" step="100"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-sqft-max" placeholder="3000" step="100"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Price</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-price-min" placeholder="200k" step="10000"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-price-max" placeholder="500k" step="10000"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Year Built</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="filter-year-min" placeholder="1990" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="filter-year-max" placeholder="2020" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">HOA</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="filter-hoa">
                <option value="">Any</option>
                <option value="none">No HOA</option>
                <option value="has">Has HOA</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Type</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <div id="pe-type-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="pe-type-trigger">
                  <span class="multiselect-label">Any</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="pe-type-dropdown">
                  <div class="multiselect-options" id="pe-type-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster filter-actions">
          <button id="filter-apply" class="btn-primary">Apply</button>
          <button id="filter-clear" class="btn-secondary">Clear</button>
        </div>
      </div>
      <div id="explorer-map" class="explorer-map"></div>
      <div id="results-summary" class="results-summary"></div>
      <div id="results-table-wrap" class="table-scroll"></div>
      <div id="comp-hover-backdrop" class="comp-hover-backdrop" style="display:none"></div>
      <div id="comp-hover-card" class="comp-hover-card" style="display:none">
        <button class="comp-hover-close" id="comp-hover-close">&times;</button>
        <div id="comp-hover-content"></div>
      </div>
    `;

    // Learn More modal
    const peModal = document.getElementById('pe-modal');
    document.getElementById('pe-learn-more').addEventListener('click', () => peModal.style.display = 'flex');
    document.getElementById('pe-modal-close').addEventListener('click', () => peModal.style.display = 'none');
    peModal.addEventListener('click', (e) => { if (e.target === peModal) peModal.style.display = 'none'; });

    // Comp hover card dismiss
    document.getElementById('comp-hover-close').addEventListener('click', () => this._hideComps());
    document.getElementById('comp-hover-backdrop').addEventListener('click', () => this._hideComps());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._hideComps(); });

    // Restore saved filters
    const saved = Prefs.get('pe', {});
    if (Array.isArray(saved.areas)) this._selectedAreas = new Set(saved.areas);
    if (saved.bedsMin) document.getElementById('filter-beds-min').value = saved.bedsMin;
    if (saved.bedsMax) document.getElementById('filter-beds-max').value = saved.bedsMax;
    if (saved.bathsMin) document.getElementById('filter-baths-min').value = saved.bathsMin;
    if (saved.bathsMax) document.getElementById('filter-baths-max').value = saved.bathsMax;
    if (saved.sqftMin) document.getElementById('filter-sqft-min').value = saved.sqftMin;
    if (saved.sqftMax) document.getElementById('filter-sqft-max').value = saved.sqftMax;
    if (saved.priceMin) document.getElementById('filter-price-min').value = saved.priceMin;
    if (saved.priceMax) document.getElementById('filter-price-max').value = saved.priceMax;
    if (saved.hoa) document.getElementById('filter-hoa').value = saved.hoa;
    if (saved.yearMin) document.getElementById('filter-year-min').value = saved.yearMin;
    if (saved.yearMax) document.getElementById('filter-year-max').value = saved.yearMax;
    if (saved.type) {
      const types = Array.isArray(saved.type) ? saved.type : [saved.type];
      this._selectedTypes = new Set(types);
    }

    // Restore saved sort
    const savedSort = Prefs.get('pe.sort');
    if (savedSort && savedSort.col) {
      this._sort.col = savedSort.col;
      this._sort.asc = savedSort.asc;
    }

    // Bind events
    const collapseDisclosure = () => { if (this._filterDisclosure) this._filterDisclosure.collapse(); };
    document.getElementById('filter-apply').addEventListener('click', () => { this._applyFilters(focusAreas); collapseDisclosure(); });
    document.getElementById('filter-clear').addEventListener('click', () => { this._clearFilters(focusAreas); collapseDisclosure(); });
    container.querySelectorAll('input').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { this._applyFilters(focusAreas); collapseDisclosure(); } });
    });

    this._initMap();
    this._photoTooltip = MapUtils.createPhotoTooltip();
    MapUtils.initAreaMultiSelect({
      optionsElId: 'pe-area-options', dropdownElId: 'pe-area-dropdown',
      triggerElId: 'pe-area-trigger', selectElId: 'pe-area-select',
      focusAreas, selectedAreas: this._selectedAreas,
      onChanged: () => { this._updateAreaTrigger(); this._applyFilters(focusAreas); },
      enableDraw: () => this._enableDraw(),
      disableDraw: () => { this._disableDraw(); this._customPolygon = null; },
    });
    this._updateAreaTrigger();

    MapUtils.initSimpleMultiSelect({
      optionsElId: 'pe-type-options', dropdownElId: 'pe-type-dropdown',
      triggerElId: 'pe-type-trigger', selectElId: 'pe-type-select',
      items: this._typeOptions, selected: this._selectedTypes,
      onChanged: () => { this._updateTypeTrigger(); this._applyFilters(focusAreas); },
    });
    this._updateTypeTrigger();

    this._filterDisclosure = MapUtils.initFilterDisclosure({
      filterBarEl: container.querySelector('.filter-bar'),
      selectedAreas: this._selectedAreas,
    });
    this._applyFilters(focusAreas);
  },

  _initMap() {
    this._map = MapUtils.createMap('explorer-map', this._allHomes, this._metro.map_center, this._metro.map_zoom);
    this._areaPolygonsLayer = L.featureGroup().addTo(this._map);
    this._drawnItems = L.featureGroup().addTo(this._map);
    this._markersLayer = L.layerGroup().addTo(this._map);
    this._drawControl = MapUtils.createDrawControl(this._drawnItems);
    MapUtils.bindDrawEvents(this._map, this._drawnItems, {
      onCreated: (polygon) => { this._customPolygon = polygon; this._applyFilters(this._focusAreas); },
      onDeleted: () => {
        this._customPolygon = null;
        this._selectedAreas.delete('custom');
        const cb = document.querySelector('#pe-area-options [data-key="custom"] input');
        if (cb) cb.checked = false;
        this._updateAreaTrigger();
        this._applyFilters(this._focusAreas);
      },
      onEdited: (polygon) => { this._customPolygon = polygon; this._applyFilters(this._focusAreas); },
    });
    this._renderMarkers(this._allHomes);
  },

  _enableDraw() { MapUtils.enableDraw(this._map, this._drawControl); },
  _disableDraw() { MapUtils.disableDraw(this._map, this._drawControl, this._drawnItems); },
  _updateAreaTrigger() { MapUtils.updateAreaTrigger('#pe-area-trigger', this._selectedAreas, this._focusAreas); },
  _updateTypeTrigger() { MapUtils.updateSimpleMultiTrigger('#pe-type-trigger', this._selectedTypes, this._typeOptions, 'Any'); },

  _renderMarkers(homes) {
    this._markersByAddr = MapUtils.renderMarkers({
      layer: this._markersLayer, data: homes,
      rowSelector: '#results-table-wrap .clickable-row',
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
    });
  },

  _getFilters() {
    return {
      areas: [...this._selectedAreas],
      bedsMin: document.getElementById('filter-beds-min').value,
      bedsMax: document.getElementById('filter-beds-max').value,
      bathsMin: document.getElementById('filter-baths-min').value,
      bathsMax: document.getElementById('filter-baths-max').value,
      sqftMin: document.getElementById('filter-sqft-min').value,
      sqftMax: document.getElementById('filter-sqft-max').value,
      priceMin: document.getElementById('filter-price-min').value,
      priceMax: document.getElementById('filter-price-max').value,
      hoa: document.getElementById('filter-hoa').value,
      yearMin: document.getElementById('filter-year-min').value,
      yearMax: document.getElementById('filter-year-max').value,
      type: [...this._selectedTypes],
    };
  },

  _clearFilters(focusAreas) {
    this._selectedAreas = new Set();
    document.querySelectorAll('#pe-area-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateAreaTrigger();
    this._selectedTypes = new Set();
    document.querySelectorAll('#pe-type-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateTypeTrigger();
    ['filter-beds-min','filter-beds-max','filter-baths-min','filter-baths-max',
     'filter-sqft-min','filter-sqft-max','filter-price-min','filter-price-max',
     'filter-hoa','filter-year-min','filter-year-max',
    ].forEach(id => document.getElementById(id).value = '');
    this._customPolygon = null;
    this._disableDraw();
    this._areaPolygonsLayer.clearLayers();
    this._applyFilters(focusAreas);
  },

  _applyFilters(focusAreas) {
    const f = this._getFilters();
    Prefs.set('pe', f);
    let homes = MapUtils.applyAreaFilter([...this._allHomes], f.areas, this._customPolygon, focusAreas);
    homes = MapUtils.applyCommonFilters(homes, f, 'sale_price');

    this._filteredHomes = homes;
    this._renderMarkers(homes);

    const namedAreas = f.areas.filter(a => a !== 'custom');
    if (namedAreas.length > 0) {
      MapUtils.showAreaPolygons(this._map, this._areaPolygonsLayer, namedAreas, focusAreas, homes);
    }
    this._renderResults(homes);
    if (this._filterDisclosure) this._filterDisclosure.refreshCount();
  },

  _renderResults(homes) {
    const prices = homes.map(h => h.sale_price).filter(v => v != null);
    const sqfts = homes.map(h => h.sqft).filter(v => v != null);
    document.getElementById('results-summary').innerHTML = `
      <span><strong>${homes.length}</strong> properties</span>
      <span>Median: <strong>${Utils.formatCurrency(Utils.median(prices))}</strong></span>
      <span>Median SqFt: <strong>${Utils.formatNumber(Utils.median(sqfts))}</strong></span>
      <span>Median $/SqFt: <strong>${Utils.formatCurrency(Utils.median(homes.map(h => h.price_per_sqft).filter(v => v != null)))}</strong></span>
    `;

    MapUtils.sortData(homes, this._sort.col, this._sort.asc);
    const display = homes.slice(0, 200);
    const headerHtml = MapUtils.renderHeaders(this._headers, this._sort.col, this._sort.asc);

    const rowsHtml = display.map(h => `
      <tr class="clickable-row" data-addr="${(h.address || '').replace(/"/g, '&quot;')}">
        ${MapUtils.PHOTO_BTN_HTML}
        <td>${Utils.formatDate(h.sold_date)}</td>
        <td>${Utils.visualQualityBadge(h)}</td>
        <td class="addr-cell"><a href="${this._zillowUrl(h)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${h.address || '—'}</a></td>
        <td>${h.city || '—'}</td>
        <td>${h.neighborhood || '—'}</td>
        <td>${Utils.formatCurrency(h.sale_price)}</td>
        <td>${h.hoa_monthly != null ? Utils.formatCurrency(h.hoa_monthly) : '—'}</td>
        <td>${Utils.formatCurrency(h.price_per_sqft)}</td>
        <td>${Utils.formatNumber(h.sqft)}</td>
        <td>${h.beds ?? '—'}</td>
        <td>${h.baths ?? '—'}</td>
        <td>${h.year_built ?? '—'}</td>
      </tr>
    `).join('');

    document.getElementById('results-table-wrap').innerHTML = `
      <table class="data-table"><thead><tr><th class="photo-preview-cell"></th>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
      ${homes.length > 200 ? `<p class="table-note">Showing 200 of ${homes.length} results</p>` : ''}
    `;

    MapUtils.bindSortHeaders('#results-table-wrap .sortable', this._sort, ['address', 'sold_date'],
      () => { Prefs.set('pe.sort', { col: this._sort.col, asc: this._sort.asc }); this._renderResults(this._filteredHomes); });

    MapUtils.bindTableMarkerHovers({
      rows: '#results-table-wrap .clickable-row', items: homes,
      markersByAddr: this._markersByAddr,
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
      onRowClick: (h) => this._showComps(h),
    });
  },

  _showComps(home) {
    const scoredComps = Utils.findComps(home, this._allHomes);
    const comps = scoredComps.map(s => s.home);
    const scoreMap = new Map(scoredComps.map(s => [s.home.address, s.score]));

    const medianComp = Utils.median(comps.map(h => h.sale_price));
    const compDiff = medianComp && home.sale_price
      ? ((home.sale_price - medianComp) / medianComp * 100).toFixed(1) : null;

    document.getElementById('comp-hover-content').innerHTML = `
      <h3>Comparable Sales Analysis</h3>
      <div class="comp-header">
        <div class="comp-subject">
          ${MapUtils.compSubjectCarouselHTML(home)}
          <div class="comp-subject-info">
            <h4><a href="${this._zillowUrl(home)}" target="_blank" rel="noopener">${home.address}</a></h4>
            <p>${home.city} ${home.zip_code} · ${home.beds}bd/${home.baths}ba · ${Utils.formatNumber(home.sqft)} sqft</p>
            <p class="comp-price">Sold: ${Utils.formatCurrency(home.sale_price)} ${home.sold_date ? `on ${Utils.formatDate(home.sold_date)}` : ''} ${Utils.visualQualityBadge(home)}</p>
          </div>
        </div>
        <div class="comp-metrics">
          <div class="metric">
            <span class="metric-label">vs. Median Comp</span>
            <span class="metric-value">${medianComp ? Utils.formatCurrency(medianComp) : '—'}</span>
            ${compDiff ? `<span class="metric-delta ${Number(compDiff) > 0 ? 'delta-up' : 'delta-down'}">${compDiff > 0 ? '+' : ''}${compDiff}%</span>` : ''}
          </div>
          <div class="metric">
            <span class="metric-label">Comps Found</span>
            <span class="metric-value">${comps.length}</span>
          </div>
        </div>
      </div>
      <div id="comp-hover-map" class="comp-map"></div>
      ${comps.length > 0 ? `
        <table class="data-table comp-table"><thead><tr>
          <th class="photo-preview-cell"></th><th>Match</th><th>VQ</th><th>Sold</th><th>Address</th><th>Price</th><th>$/SqFt</th><th>SqFt</th><th>Bd/Ba</th>
        </tr></thead><tbody>
          ${comps.slice(0, 15).map(c => { const sc = scoreMap.get(c.address) || 0; return `<tr>
            ${MapUtils.PHOTO_BTN_HTML}
            <td><span class="match-badge ${Utils.similarityBadgeClass(sc)}">${sc}%</span></td>
            <td>${Utils.visualQualityBadge(c)}</td>
            <td>${Utils.formatDate(c.sold_date)}</td>
            <td><a href="${this._zillowUrl(c)}" target="_blank" rel="noopener">${c.address}</a></td>
            <td>${Utils.formatCurrency(c.sale_price)}</td>
            <td>${Utils.formatCurrency(c.price_per_sqft)}</td>
            <td>${Utils.formatNumber(c.sqft)}</td>
            <td>${c.beds}/${c.baths}</td>
          </tr>`; }).join('')}
        </tbody></table>
      ` : '<p class="empty-state">No comparable sales found with similar characteristics.</p>'}
    `;

    document.getElementById('comp-hover-card').style.display = 'block';
    document.getElementById('comp-hover-backdrop').style.display = 'block';
    const photos = home.photo_urls && home.photo_urls.length
      ? home.photo_urls : (home.photo_url ? [home.photo_url] : []);
    MapUtils.initCompCarousel(document.querySelector('#comp-hover-content .comp-subject-carousel'), photos);
    this._initCompMap(home, comps);

    MapUtils.bindTableMarkerHovers({
      rows: document.querySelectorAll('#comp-hover-content .comp-table tbody tr'),
      items: comps.slice(0, 15), markersByAddr: this._compMarkersByAddr,
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
      defaultOpacity: 0.7,
    });
  },

  _hideComps() {
    document.getElementById('comp-hover-card').style.display = 'none';
    document.getElementById('comp-hover-backdrop').style.display = 'none';
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
  },

  _initCompMap(home, comps) {
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
    this._compMarkersByAddr = {};
    const result = MapUtils.createCompMap('comp-hover-map', home, comps, {
      subjectLabel: 'subject',
      onCompHover: (c, e, isOver) => {
        const me = e.originalEvent;
        if (isOver && me) this._showPhoto(c, me.clientX, me.clientY);
        if (!isOver) this._hidePhoto();
      },
    });
    if (result) { this._compMap = result.map; this._compMarkersByAddr = result.markersByAddr; }
  },

  _showPhoto(home, x, y) { MapUtils.showPhoto(this._photoTooltip, this._photoTimeout, home, x, y, 'sale_price'); },
  _hidePhoto() { MapUtils.hidePhoto(this._photoTooltip, this._photoTimeout); },

  _zillowUrl(h) {
    return `https://www.zillow.com/homes/${[h.address, h.city, this._metro.state_code || '', h.zip_code].filter(Boolean).join(' ').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-')}_rb/`;
  },
};
