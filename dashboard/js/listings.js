/**
 * Listings tab — browse active for-sale listings.
 * Similar to Property Explorer but focused on what you can buy right now.
 */

const Listings = {
  _filteredListings: [],
  _allListings: [],
  _allSold: [],
  _sort: { col: 'first_seen', asc: false },
  _selectedTypes: new Set(),
  _selectedStatuses: new Set(),
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

  NEW_DAYS: 3,

  _typeOptions: [
    { value: 'Single Family Residential', label: 'Single Family' },
    { value: 'Townhouse', label: 'Townhouse' },
    { value: 'Condo/Co-op', label: 'Condo' },
  ],
  _statusOptions: [
    { value: 'new', label: 'New Only' },
    { value: 'price-drop', label: 'Price Drops' },
    { value: 'favorited', label: 'Favorited' },
    { value: 'hide-downvoted', label: 'Hide Ruled Out' },
    { value: 'downvoted', label: 'Ruled Out Only' },
  ],

  _headers: [
    { col: null, label: '', sortable: false },
    { col: 'first_seen', label: 'Listed' },
    { col: 'visual_quality', label: 'VQ' },
    { col: 'address', label: 'Address' },
    { col: 'city', label: 'City' },
    { col: 'list_price', label: 'Price' },
    { col: null, label: 'Value<span class="info-icon" data-tooltip="Asking price vs median of recent sold comps in the same zip with similar specs">i</span>', sortable: false },
    { col: 'price_change', label: 'Price \u0394' },
    { col: 'hoa_monthly', label: 'HOA/mo' },
    { col: 'price_per_sqft', label: '$/SqFt' },
    { col: 'sqft', label: 'SqFt' },
    { col: 'beds', label: 'Bd' },
    { col: 'baths', label: 'Ba' },
    { col: 'year_built', label: 'Year' },
    { col: 'days_on_market', label: 'DOM' },
  ],

  init(container, data) {
    this._allListings = data.active_listings || [];
    this._allSold = data.sold_homes || [];
    this._metro = data.config.metro || {};
    this._focusAreas = data.config.focus_areas;
    const focusAreas = this._focusAreas;

    const freshness = data.data_freshness || {};
    const lastUpdated = freshness.active_listings
      ? MapUtils.formatAge(freshness.active_listings) : 'unknown';

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>To Buy</h2>
          <button id="ls-learn-more" class="btn-learn-more" aria-label="Learn more about listings" title="Learn more">&#9432;</button>
          <span class="freshness-badge" title="Last data refresh">Active listings updated ${lastUpdated}</span>
        </div>
        <p class="subtitle">Browse active for-sale listings. Homes with recent price drops or new to market are flagged.</p>
      </div>
      <div id="ls-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="ls-modal-close">&times;</button>
          <h3>About Listings Data</h3>
          <p>Listings shows <strong>currently active for-sale homes</strong> pulled from Redfin. The data refreshes twice daily.</p>
          <h4>Badges</h4>
          <ul>
            <li><strong>NEW</strong> — Listed within the last ${this.NEW_DAYS} days</li>
            <li><strong>PRICE DROP</strong> — Asking price has been reduced since first listed</li>
          </ul>
          <h4>Value Analysis</h4>
          <p>Click any listing to see how its asking price compares to recent sold comps in the same zip code with similar specs. This helps answer: <em>"Is this asking price reasonable?"</em></p>
          <h4>Data sources</h4>
          <ul>
            <li><strong>Listing data:</strong> Redfin active listings API</li>
            <li><strong>Sold comps:</strong> Redfin sold listings (last ~90 days)</li>
          </ul>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-cluster">
          <div class="filter-cluster-label">Area</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <div id="ls-area-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="ls-area-trigger">
                  <span class="multiselect-label">All Areas</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="ls-area-dropdown">
                  <div class="multiselect-options" id="ls-area-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Beds</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-beds-min" min="0" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-beds-max" min="0" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Baths</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-baths-min" min="0" step="0.5"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-baths-max" min="0" step="0.5"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Sq Ft</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-sqft-min" step="100"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-sqft-max" step="100"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Price</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-price-min" step="10000"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-price-max" step="10000"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Year Built</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-year-min" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-year-max" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Aesthetic</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="ls-filter-aesthetic-min" min="0" max="100" step="5"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="ls-filter-aesthetic-max" min="0" max="100" step="5"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">HOA</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="ls-filter-hoa">
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
              <div id="ls-type-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="ls-type-trigger">
                  <span class="multiselect-label">Any</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="ls-type-dropdown">
                  <div class="multiselect-options" id="ls-type-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Status</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <div id="ls-status-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="ls-status-trigger">
                  <span class="multiselect-label">All</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="ls-status-dropdown">
                  <div class="multiselect-options" id="ls-status-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster filter-actions">
          <button id="ls-filter-apply" class="btn-primary">Apply</button>
          <button id="ls-filter-clear" class="btn-secondary">Clear</button>
        </div>
      </div>
      <div id="ls-map" class="explorer-map"></div>
      <div id="ls-results-summary" class="results-summary"></div>
      <div id="ls-results-table-wrap" class="table-scroll"></div>
      <div id="ls-comp-backdrop" class="comp-hover-backdrop" style="display:none"></div>
      <div id="ls-comp-card" class="comp-hover-card" style="display:none">
        <button class="comp-hover-close" id="ls-comp-close">&times;</button>
        <div id="ls-comp-content"></div>
      </div>
    `;

    // Learn More modal
    const modal = document.getElementById('ls-modal');
    document.getElementById('ls-learn-more').addEventListener('click', () => modal.style.display = 'flex');
    document.getElementById('ls-modal-close').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Comp card dismiss
    document.getElementById('ls-comp-close').addEventListener('click', () => this._hideComps());
    document.getElementById('ls-comp-backdrop').addEventListener('click', () => this._hideComps());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._hideComps(); });

    // Restore saved filters
    const saved = Prefs.get('ls', {});
    if (Array.isArray(saved.areas)) this._selectedAreas = new Set(saved.areas);
    if (saved.bedsMin) document.getElementById('ls-filter-beds-min').value = saved.bedsMin;
    if (saved.bedsMax) document.getElementById('ls-filter-beds-max').value = saved.bedsMax;
    if (saved.bathsMin) document.getElementById('ls-filter-baths-min').value = saved.bathsMin;
    if (saved.bathsMax) document.getElementById('ls-filter-baths-max').value = saved.bathsMax;
    if (saved.sqftMin) document.getElementById('ls-filter-sqft-min').value = saved.sqftMin;
    if (saved.sqftMax) document.getElementById('ls-filter-sqft-max').value = saved.sqftMax;
    if (saved.priceMin) document.getElementById('ls-filter-price-min').value = saved.priceMin;
    if (saved.priceMax) document.getElementById('ls-filter-price-max').value = saved.priceMax;
    if (saved.hoa) document.getElementById('ls-filter-hoa').value = saved.hoa;
    if (saved.yearMin) document.getElementById('ls-filter-year-min').value = saved.yearMin;
    if (saved.yearMax) document.getElementById('ls-filter-year-max').value = saved.yearMax;
    if (saved.type) {
      const types = Array.isArray(saved.type) ? saved.type : [saved.type];
      this._selectedTypes = new Set(types);
    }
    if (saved.status) {
      const statuses = Array.isArray(saved.status) ? saved.status : [saved.status];
      this._selectedStatuses = new Set(statuses);
    }
    if (saved.aestheticMin) document.getElementById('ls-filter-aesthetic-min').value = saved.aestheticMin;
    if (saved.aestheticMax) document.getElementById('ls-filter-aesthetic-max').value = saved.aestheticMax;

    // Restore saved sort
    const savedSort = Prefs.get('ls.sort');
    if (savedSort && savedSort.col) {
      this._sort.col = savedSort.col;
      this._sort.asc = savedSort.asc;
    }

    // Bind events
    const collapseDisclosure = () => { if (this._filterDisclosure) this._filterDisclosure.collapse(); };
    document.getElementById('ls-filter-apply').addEventListener('click', () => { this._applyFilters(focusAreas); collapseDisclosure(); });
    document.getElementById('ls-filter-clear').addEventListener('click', () => { this._clearFilters(focusAreas); collapseDisclosure(); });
    container.querySelectorAll('input').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { this._applyFilters(focusAreas); collapseDisclosure(); } });
    });

    this._initMap();
    this._photoTooltip = MapUtils.createPhotoTooltip();
    MapUtils.initAreaMultiSelect({
      optionsElId: 'ls-area-options', dropdownElId: 'ls-area-dropdown',
      triggerElId: 'ls-area-trigger', selectElId: 'ls-area-select',
      focusAreas, selectedAreas: this._selectedAreas,
      onChanged: () => { this._updateAreaTrigger(); this._applyFilters(focusAreas); },
      enableDraw: () => this._enableDraw(),
      disableDraw: () => { this._disableDraw(); this._customPolygon = null; },
    });
    this._updateAreaTrigger();

    MapUtils.initSimpleMultiSelect({
      optionsElId: 'ls-type-options', dropdownElId: 'ls-type-dropdown',
      triggerElId: 'ls-type-trigger', selectElId: 'ls-type-select',
      items: this._typeOptions, selected: this._selectedTypes,
      onChanged: () => { this._updateTypeTrigger(); this._applyFilters(focusAreas); },
    });
    this._updateTypeTrigger();

    MapUtils.initSimpleMultiSelect({
      optionsElId: 'ls-status-options', dropdownElId: 'ls-status-dropdown',
      triggerElId: 'ls-status-trigger', selectElId: 'ls-status-select',
      items: this._statusOptions, selected: this._selectedStatuses,
      onChanged: () => { this._updateStatusTrigger(); this._applyFilters(focusAreas); },
    });
    this._updateStatusTrigger();

    this._filterDisclosure = MapUtils.initFilterDisclosure({
      filterBarEl: container.querySelector('.filter-bar'),
      selectedAreas: this._selectedAreas,
    });
    this._applyFilters(focusAreas);
  },

  _initMap() {
    this._map = MapUtils.createMap('ls-map', this._allListings, this._metro.map_center, this._metro.map_zoom);
    this._areaPolygonsLayer = L.featureGroup().addTo(this._map);
    this._drawnItems = L.featureGroup().addTo(this._map);
    this._markersLayer = L.layerGroup().addTo(this._map);
    this._drawControl = MapUtils.createDrawControl(this._drawnItems);
    MapUtils.bindDrawEvents(this._map, this._drawnItems, {
      onCreated: (polygon) => { this._customPolygon = polygon; this._applyFilters(this._focusAreas); },
      onDeleted: () => {
        this._customPolygon = null;
        this._selectedAreas.delete('custom');
        const cb = document.querySelector('#ls-area-options [data-key="custom"] input');
        if (cb) cb.checked = false;
        this._updateAreaTrigger();
        this._applyFilters(this._focusAreas);
      },
      onEdited: (polygon) => { this._customPolygon = polygon; this._applyFilters(this._focusAreas); },
    });
    this._renderMarkers(this._allListings);
  },

  _enableDraw() { MapUtils.enableDraw(this._map, this._drawControl); },
  _disableDraw() { MapUtils.disableDraw(this._map, this._drawControl, this._drawnItems); },
  _updateAreaTrigger() { MapUtils.updateAreaTrigger('#ls-area-trigger', this._selectedAreas, this._focusAreas); },
  _updateTypeTrigger() { MapUtils.updateSimpleMultiTrigger('#ls-type-trigger', this._selectedTypes, this._typeOptions, 'Any'); },
  _updateStatusTrigger() { MapUtils.updateSimpleMultiTrigger('#ls-status-trigger', this._selectedStatuses, this._statusOptions, 'All'); },

  _markerColor(listing) {
    if (listing.price_change && listing.price_change < 0) return '#16a34a';
    if (this._isNew(listing)) return '#ea580c';
    return '#2563eb';
  },

  _isNew(listing) {
    if (!listing.first_seen) return false;
    try { return (new Date() - new Date(listing.first_seen)) / 86400000 <= this.NEW_DAYS; }
    catch { return false; }
  },

  _renderMarkers(listings) {
    this._markersByAddr = MapUtils.renderMarkers({
      layer: this._markersLayer, data: listings,
      rowSelector: '#ls-results-table-wrap .clickable-row',
      colorFn: (h) => this._markerColor(h),
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
    });
  },

  _getFilters() {
    return {
      areas: [...this._selectedAreas],
      bedsMin: document.getElementById('ls-filter-beds-min').value,
      bedsMax: document.getElementById('ls-filter-beds-max').value,
      bathsMin: document.getElementById('ls-filter-baths-min').value,
      bathsMax: document.getElementById('ls-filter-baths-max').value,
      sqftMin: document.getElementById('ls-filter-sqft-min').value,
      sqftMax: document.getElementById('ls-filter-sqft-max').value,
      priceMin: document.getElementById('ls-filter-price-min').value,
      priceMax: document.getElementById('ls-filter-price-max').value,
      hoa: document.getElementById('ls-filter-hoa').value,
      yearMin: document.getElementById('ls-filter-year-min').value,
      yearMax: document.getElementById('ls-filter-year-max').value,
      type: [...this._selectedTypes],
      status: [...this._selectedStatuses],
      aestheticMin: document.getElementById('ls-filter-aesthetic-min').value,
      aestheticMax: document.getElementById('ls-filter-aesthetic-max').value,
    };
  },

  _clearFilters(focusAreas) {
    this._selectedAreas = new Set();
    document.querySelectorAll('#ls-area-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateAreaTrigger();
    this._selectedTypes = new Set();
    document.querySelectorAll('#ls-type-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateTypeTrigger();
    this._selectedStatuses = new Set();
    document.querySelectorAll('#ls-status-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateStatusTrigger();
    ['ls-filter-beds-min','ls-filter-beds-max','ls-filter-baths-min','ls-filter-baths-max',
     'ls-filter-sqft-min','ls-filter-sqft-max','ls-filter-price-min','ls-filter-price-max',
     'ls-filter-hoa','ls-filter-year-min','ls-filter-year-max',
     'ls-filter-aesthetic-min','ls-filter-aesthetic-max',
    ].forEach(id => document.getElementById(id).value = '');
    this._customPolygon = null;
    this._disableDraw();
    this._areaPolygonsLayer.clearLayers();
    this._applyFilters(focusAreas);
  },

  _applyFilters(focusAreas) {
    const f = this._getFilters();
    Prefs.set('ls', f);
    let listings = MapUtils.applyAreaFilter([...this._allListings], f.areas, this._customPolygon, focusAreas);
    listings = MapUtils.applyCommonFilters(listings, f, 'list_price');

    // Listings-specific status filters (multiselect — array of selected values)
    const statuses = Array.isArray(f.status) ? f.status : (f.status ? [f.status] : []);
    if (statuses.length > 0) {
      const positiveStatuses = statuses.filter(s => s !== 'hide-downvoted');
      const hideDownvoted = statuses.includes('hide-downvoted');

      if (positiveStatuses.length > 0) {
        listings = listings.filter(h => positiveStatuses.some(s => {
          if (s === 'new') return this._isNew(h);
          if (s === 'price-drop') return h.price_change && h.price_change < 0;
          if (s === 'favorited') return FavoritesStore.isFavorited(h.address, 'buy');
          if (s === 'downvoted') return DownvoteStore.isDownvoted(h.address, 'buy');
          return false;
        }));
      }

      if (hideDownvoted) {
        listings = listings.filter(h => !DownvoteStore.isDownvoted(h.address, 'buy'));
      }
    }

    this._filteredListings = listings;
    this._renderMarkers(listings);

    const namedAreas = f.areas.filter(a => a !== 'custom');
    if (namedAreas.length > 0) {
      MapUtils.showAreaPolygons(this._map, this._areaPolygonsLayer, namedAreas, focusAreas, listings);
    }
    this._renderResults(listings);
    if (this._filterDisclosure) this._filterDisclosure.refreshCount();
  },

  _renderResults(listings) {
    const prices = listings.map(h => h.list_price).filter(v => v != null);
    const sqfts = listings.map(h => h.sqft).filter(v => v != null);
    const newCount = listings.filter(h => this._isNew(h)).length;
    const dropCount = listings.filter(h => h.price_change && h.price_change < 0).length;

    document.getElementById('ls-results-summary').innerHTML = `
      <span><strong>${listings.length}</strong> listings</span>
      <span>Median: <strong>${Utils.formatCurrency(Utils.median(prices))}</strong></span>
      <span>Median SqFt: <strong>${Utils.formatNumber(Utils.median(sqfts))}</strong></span>
      <span>Median $/SqFt: <strong>${Utils.formatCurrency(Utils.median(listings.map(h => h.price_per_sqft).filter(v => v != null)))}</strong></span>
      ${newCount > 0 ? `<span class="badge badge-new" title="Listed within the last 3 days">${newCount} new</span>` : ''}
      ${dropCount > 0 ? `<span class="badge badge-drop" title="Asking price has been reduced since first listed">${dropCount} price drops</span>` : ''}
      ${(() => { const fc = listings.filter(h => FavoritesStore.isFavorited(h.address, 'buy')).length; return fc > 0 ? `<span class="badge badge-fav" title="Listings you've marked as favorites">${fc} favorited</span>` : ''; })()}
      ${(() => { const dc = listings.filter(h => DownvoteStore.isDownvoted(h.address, 'buy')).length; return dc > 0 ? `<span class="badge badge-downvote" title="Listings you've ruled out">${dc} ruled out</span>` : ''; })()}
    `;

    MapUtils.sortData(listings, this._sort.col, this._sort.asc);
    const display = listings.slice(0, 200);
    const headerHtml = MapUtils.renderHeaders(this._headers, this._sort.col, this._sort.asc);

    const rowsHtml = display.map(h => {
      const badges = [];
      if (this._isNew(h)) badges.push('<span class="badge badge-new" title="Listed within the last 3 days">NEW</span>');
      if (h.price_change && h.price_change < 0) badges.push('<span class="badge badge-drop" title="Asking price has been reduced since first listed">DROP</span>');
      const valueHtml = this._valueIndicator(h);
      let priceChangeHtml = '\u2014';
      if (h.price_change && h.price_change !== 0) {
        const sign = h.price_change > 0 ? '+' : '';
        const cls = h.price_change < 0 ? 'delta-down' : 'delta-up';
        priceChangeHtml = `<span class="${cls}">${sign}${Utils.formatCurrency(h.price_change)}</span>`;
      }
      const isFav = FavoritesStore.isFavorited(h.address, 'buy');
      const isDown = DownvoteStore.isDownvoted(h.address, 'buy');
      return `
        <tr class="clickable-row${isDown ? ' downvoted-row' : ''}" data-addr="${(h.address || '').replace(/"/g, '&quot;')}">
          <td><button class="btn-fav${isFav ? ' active' : ''}" data-fav-addr="${(h.address || '').replace(/"/g, '&quot;')}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '&#9733;' : '&#9734;'}</button><button class="btn-downvote${isDown ? ' active' : ''}" data-down-addr="${(h.address || '').replace(/"/g, '&quot;')}" title="${isDown ? 'Remove rule-out' : 'Rule out this listing'}">${isDown ? '&#8634;' : '&#10005;'}</button></td>
          ${MapUtils.PHOTO_BTN_HTML}
          <td>${Utils.formatDate(h.first_seen)} ${badges.join(' ')}</td>
          <td>${Utils.visualQualityBadge(h)}</td>
          <td class="addr-cell"><a href="${h.redfin_url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${h.address || '\u2014'}</a></td>
          <td>${h.city || '\u2014'}</td>
          <td>${Utils.formatCurrency(h.list_price)}</td>
          <td>${valueHtml}</td>
          <td>${priceChangeHtml}</td>
          <td>${h.hoa_monthly != null ? Utils.formatCurrency(h.hoa_monthly) : '\u2014'}</td>
          <td>${Utils.formatCurrency(h.price_per_sqft)}</td>
          <td>${Utils.formatNumber(h.sqft)}</td>
          <td>${h.beds ?? '\u2014'}</td>
          <td>${h.baths ?? '\u2014'}</td>
          <td>${h.year_built ?? '\u2014'}</td>
          <td>${h.days_on_market ?? '\u2014'}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('ls-results-table-wrap').innerHTML = `
      <table class="data-table"><thead><tr><th class="photo-preview-cell"></th>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
      ${listings.length > 200 ? `<p class="table-note">Showing 200 of ${listings.length} results</p>` : ''}
    `;

    MapUtils.bindSortHeaders('#ls-results-table-wrap .sortable', this._sort, ['address', 'first_seen'],
      () => { Prefs.set('ls.sort', { col: this._sort.col, asc: this._sort.asc }); this._renderResults(this._filteredListings); });

    // Star (favorite) button handlers
    document.querySelectorAll('#ls-results-table-wrap .btn-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const addr = btn.dataset.favAddr;
        const listing = this._allListings.find(h => h.address === addr);
        if (!listing) return;
        const nowFav = FavoritesStore.toggle(listing, 'buy');
        btn.classList.toggle('active', nowFav);
        btn.innerHTML = nowFav ? '&#9733;' : '&#9734;';
        btn.title = nowFav ? 'Remove from favorites' : 'Add to favorites';
        // Mutual exclusion: favoriting removes downvote
        if (nowFav && DownvoteStore.isDownvoted(addr, 'buy')) {
          DownvoteStore.remove(addr, 'buy');
          const downBtn = btn.parentElement.querySelector('.btn-downvote');
          if (downBtn) downBtn.classList.remove('active');
          btn.closest('tr').classList.remove('downvoted-row');
        }
        this._updateFavTabCount();
      });
    });

    // Downvote (rule-out) button handlers
    document.querySelectorAll('#ls-results-table-wrap .btn-downvote').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const addr = btn.dataset.downAddr;
        const nowDown = DownvoteStore.toggle(addr, 'buy');
        btn.classList.toggle('active', nowDown);
        btn.title = nowDown ? 'Remove rule-out' : 'Rule out this listing';
        const row = btn.closest('tr');
        row.classList.toggle('downvoted-row', nowDown);
        // Mutual exclusion: downvoting removes favorite
        if (nowDown && FavoritesStore.isFavorited(addr, 'buy')) {
          FavoritesStore.remove(addr, 'buy');
          const favBtn = row.querySelector('.btn-fav');
          if (favBtn) {
            favBtn.classList.remove('active');
            favBtn.innerHTML = '&#9734;';
            favBtn.title = 'Add to favorites';
          }
          this._updateFavTabCount();
        }
      });
    });

    MapUtils.bindTableMarkerHovers({
      rows: '#ls-results-table-wrap .clickable-row', items: listings,
      markersByAddr: this._markersByAddr,
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
      onRowClick: (h) => this._showComps(h),
    });
  },

  _updateFavTabCount() {
    const count = FavoritesStore.count();
    const badge = document.getElementById('fav-tab-count');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  },

  _valueIndicator(listing) {
    if (!listing.list_price || !listing.zip_code) return '\u2014';
    const scoredComps = Utils.findComps(listing, this._allSold);
    const comps = scoredComps.map(s => s.home);
    if (comps.length < 2) return '\u2014';
    const medianSold = Utils.median(comps.map(h => h.sale_price));
    if (!medianSold) return '\u2014';
    const diff = ((listing.list_price - medianSold) / medianSold * 100).toFixed(0);
    const sign = diff >= 0 ? '+' : '';
    const cls = diff <= -3 ? 'delta-down' : diff >= 3 ? 'delta-up' : '';
    return `<span class="${cls}" title="vs median of ${comps.length} sold comps">${sign}${diff}%</span>`;
  },

  _showComps(listing) {
    const scoredComps = Utils.findComps(listing, this._allSold);
    const comps = scoredComps.map(s => s.home);
    const scoreMap = new Map(scoredComps.map(s => [s.home.address, s.score]));

    const medianComp = Utils.median(comps.map(h => h.sale_price));
    const compDiff = medianComp && listing.list_price
      ? ((listing.list_price - medianComp) / medianComp * 100).toFixed(1) : null;

    const priceDropInfo = listing.price_change && listing.price_change < 0
      ? `<div class="metric">
           <span class="metric-label">Price Drops</span>
           <span class="metric-value delta-down">${Utils.formatCurrency(listing.price_change)}</span>
           <span class="metric-delta">${listing.price_drop_count || 1} reduction${(listing.price_drop_count || 1) > 1 ? 's' : ''}</span>
         </div>` : '';

    document.getElementById('ls-comp-content').innerHTML = `
      <h3>Is This Price Reasonable?</h3>
      <div class="comp-header">
        <div class="comp-subject">
          ${MapUtils.compSubjectCarouselHTML(listing)}
          <div class="comp-subject-info">
            <h4><a href="${listing.redfin_url || '#'}" target="_blank" rel="noopener">${listing.address}</a></h4>
            <p>${listing.city} ${listing.zip_code} \u00b7 ${listing.beds}bd/${listing.baths}ba \u00b7 ${Utils.formatNumber(listing.sqft)} sqft</p>
            <p class="comp-price">Asking: ${Utils.formatCurrency(listing.list_price)} ${Utils.visualQualityBadge(listing)}</p>
          </div>
        </div>
        <div class="comp-metrics">
          <div class="metric">
            <span class="metric-label">vs. Median Sold Comp</span>
            <span class="metric-value">${medianComp ? Utils.formatCurrency(medianComp) : '\u2014'}</span>
            ${compDiff ? `<span class="metric-delta ${Number(compDiff) > 0 ? 'delta-up' : 'delta-down'}">${compDiff > 0 ? '+' : ''}${compDiff}%</span>` : ''}
          </div>
          <div class="metric">
            <span class="metric-label">Sold Comps</span>
            <span class="metric-value">${comps.length}</span>
          </div>
          ${priceDropInfo}
        </div>
      </div>
      <div id="ls-comp-map" class="comp-map"></div>
      ${comps.length > 0 ? `
        <table class="data-table comp-table"><thead><tr>
          <th class="photo-preview-cell"></th><th>Match</th><th>VQ</th><th>Sold</th><th>Address</th><th>Price</th><th>$/SqFt</th><th>SqFt</th><th>Bd/Ba</th>
        </tr></thead><tbody>
          ${comps.slice(0, 15).map(c => { const sc = scoreMap.get(c.address) || 0; return `<tr>
            ${MapUtils.PHOTO_BTN_HTML}
            <td><span class="match-badge ${Utils.similarityBadgeClass(sc)}">${sc}%</span></td>
            <td>${Utils.visualQualityBadge(c)}</td>
            <td>${Utils.formatDate(c.sold_date)}</td>
            <td class="addr-cell"><a href="${c.redfin_url || '#'}" target="_blank" rel="noopener">${c.address}</a></td>
            <td>${Utils.formatCurrency(c.sale_price)}</td>
            <td>${Utils.formatCurrency(c.price_per_sqft)}</td>
            <td>${Utils.formatNumber(c.sqft)}</td>
            <td>${c.beds}/${c.baths}</td>
          </tr>`; }).join('')}
        </tbody></table>
      ` : '<p class="empty-state">No comparable recent sales found with similar characteristics.</p>'}
    `;

    document.getElementById('ls-comp-card').style.display = 'block';
    document.getElementById('ls-comp-backdrop').style.display = 'block';
    const photos = listing.photo_urls && listing.photo_urls.length
      ? listing.photo_urls : (listing.photo_url ? [listing.photo_url] : []);
    MapUtils.initCompCarousel(document.querySelector('#ls-comp-content .comp-subject-carousel'), photos);
    this._initCompMap(listing, comps);

    MapUtils.bindTableMarkerHovers({
      rows: document.querySelectorAll('#ls-comp-content .comp-table tbody tr'),
      items: comps.slice(0, 15), markersByAddr: this._compMarkersByAddr,
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
      defaultOpacity: 0.7,
    });
  },

  _initCompMap(listing, comps) {
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
    this._compMarkersByAddr = {};
    const result = MapUtils.createCompMap('ls-comp-map', listing, comps, {
      subjectLabel: 'listing',
      onCompHover: (c, e, isOver) => {
        const me = e.originalEvent;
        if (isOver && me) this._showPhoto(c, me.clientX, me.clientY);
        if (!isOver) this._hidePhoto();
      },
    });
    if (result) { this._compMap = result.map; this._compMarkersByAddr = result.markersByAddr; }
  },

  _hideComps() {
    document.getElementById('ls-comp-card').style.display = 'none';
    document.getElementById('ls-comp-backdrop').style.display = 'none';
    if (this._compMap) { this._compMap.remove(); this._compMap = null; }
  },

  _showPhoto(listing, x, y) { MapUtils.showPhoto(this._photoTooltip, this._photoTimeout, listing, x, y, 'list_price'); },
  _hidePhoto() { MapUtils.hidePhoto(this._photoTooltip, this._photoTimeout); },
};
