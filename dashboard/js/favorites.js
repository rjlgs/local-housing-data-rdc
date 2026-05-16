/**
 * Favorites tab — view and manage starred/bookmarked properties.
 * Persists full listing snapshots in localStorage so data survives delisting.
 */

const Favorites = {
  _items: [],
  _sort: { col: 'favorited_at', asc: false },
  _map: null,
  _markersLayer: null,
  _markersByAddr: {},
  _photoTooltip: null,
  _photoTimeout: { id: null },
  _activeListings: [],

  _buyHeaders: [
    { col: null, label: '', sortable: false },
    { col: 'favorited_at', label: 'Saved' },
    { col: 'visual_quality', label: 'VQ' },
    { col: 'address', label: 'Address' },
    { col: 'city', label: 'City' },
    { col: 'list_price', label: 'Price' },
    { col: 'price_change', label: 'Price Δ' },
    { col: 'hoa_monthly', label: 'HOA/mo' },
    { col: 'price_per_sqft', label: '$/SqFt' },
    { col: 'sqft', label: 'SqFt' },
    { col: 'beds', label: 'Bd' },
    { col: 'baths', label: 'Ba' },
    { col: 'year_built', label: 'Year' },
    { col: null, label: 'Status', sortable: false },
  ],

  init(container, data) {
    this._activeListings = data.active_listings || [];
    this._metro = data.config.metro || {};

    FavoritesStore.syncStatus(this._activeListings, 'buy');

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>Favorites</h2>
        </div>
        <p class="subtitle">Your saved properties. Listings persist here even after being delisted or sold.</p>
      </div>
      <div id="fav-map" class="explorer-map"></div>
      <div id="fav-results-summary" class="results-summary"></div>
      <div id="fav-results-table-wrap" class="table-scroll"></div>
      <div id="fav-detail-backdrop" class="comp-hover-backdrop" style="display:none"></div>
      <div id="fav-detail-card" class="comp-hover-card" style="display:none">
        <button class="comp-hover-close" id="fav-detail-close">&times;</button>
        <div id="fav-detail-content"></div>
      </div>
    `;

    document.getElementById('fav-detail-close').addEventListener('click', () => this._hideDetail());
    document.getElementById('fav-detail-backdrop').addEventListener('click', () => this._hideDetail());

    const savedSort = Prefs.get('fav.sort');
    if (savedSort && savedSort.col) {
      this._sort.col = savedSort.col;
      this._sort.asc = savedSort.asc;
    }

    this._initMap();
    this._photoTooltip = MapUtils.createPhotoTooltip();
    this._renderAll();
  },

  _initMap() {
    const items = this._getFavItems();
    const dataForBounds = items.map(i => i.data).filter(d => d.latitude && d.longitude);
    this._map = MapUtils.createMap('fav-map', dataForBounds, this._metro.map_center, this._metro.map_zoom);
    this._markersLayer = L.layerGroup().addTo(this._map);
  },

  _getFavItems() {
    const favs = FavoritesStore.getAll('buy');
    return Object.keys(favs).map(key => {
      const entry = favs[key];
      const d = entry.data || {};
      return {
        key,
        ...entry,
        address: d.address,
        city: d.city,
        list_price: d.list_price,
        price_change: d.price_change,
        hoa_monthly: d.hoa_monthly,
        price_per_sqft: d.price_per_sqft,
        sqft: d.sqft,
        beds: d.beds,
        baths: d.baths,
        year_built: d.year_built,
      };
    });
  },

  _markerColor(item) {
    if (item.delisted) return '#94a3b8';
    if (item.data.price_change && item.data.price_change < 0) return '#16a34a';
    return '#2563eb';
  },

  _renderMarkers(items) {
    this._markersLayer.clearLayers();
    this._markersByAddr = {};
    items.forEach(item => {
      const d = item.data;
      if (!d.latitude || !d.longitude) return;
      const marker = L.circleMarker([d.latitude, d.longitude], {
        radius: 7, fillColor: this._markerColor(item), color: '#fff',
        weight: 1.5, fillOpacity: 0.85,
      }).addTo(this._markersLayer);
      marker.bindTooltip(`${d.address}<br>${Utils.formatCurrency(d.list_price)}`, { direction: 'top', offset: [0, -8] });
      this._markersByAddr[d.address] = marker;
    });
    if (items.length > 0) {
      const bounds = items.filter(i => i.data.latitude && i.data.longitude)
        .map(i => [i.data.latitude, i.data.longitude]);
      if (bounds.length > 0) this._map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }
  },

  _renderAll() {
    const items = this._getFavItems();
    this._items = items;
    this._renderMarkers(items);
    this._renderResults(items);
  },

  _renderResults(items) {
    const activeCount = items.filter(i => !i.delisted).length;
    const delistedCount = items.filter(i => i.delisted).length;

    const summaryEl = document.getElementById('fav-results-summary');
    summaryEl.innerHTML = items.length === 0
      ? ''
      : `<span><strong>${items.length}</strong> saved</span>
         ${activeCount > 0 ? `<span class="badge badge-active">${activeCount} active</span>` : ''}
         ${delistedCount > 0 ? `<span class="badge badge-delisted">${delistedCount} delisted</span>` : ''}`;

    if (items.length === 0) {
      document.getElementById('fav-results-table-wrap').innerHTML =
        `<p class="empty-state">No favorites yet. Star listings in the To Buy tab to save them here.</p>`;
      return;
    }

    MapUtils.sortData(items, this._sort.col, this._sort.asc);
    const headerHtml = MapUtils.renderHeaders(this._buyHeaders, this._sort.col, this._sort.asc);

    const rowsHtml = items.map(item => {
      const d = item.data;
      const statusBadge = item.delisted
        ? `<span class="badge badge-delisted">DELISTED</span>`
        : '<span class="badge badge-active">ACTIVE</span>';
      const safeAddr = (d.address || '').replace(/"/g, '&quot;');
      const link = d.listing_url || d.redfin_url || '#';
      const rowClass = `clickable-row${item.delisted ? ' fav-delisted-row' : ''}`;

      let priceChangeHtml = '—';
      if (d.price_change && d.price_change !== 0) {
        const sign = d.price_change > 0 ? '+' : '';
        const cls = d.price_change < 0 ? 'delta-down' : 'delta-up';
        priceChangeHtml = `<span class="${cls}">${sign}${Utils.formatCurrency(d.price_change)}</span>`;
      }
      return `
        <tr class="${rowClass}" data-addr="${safeAddr}">
          <td><button class="btn-fav active" data-fav-addr="${safeAddr}" title="Remove from favorites">&#9733;</button></td>
          <td>${Utils.formatDate(item.favorited_at)}</td>
          <td>${Utils.visualQualityBadge(d)}</td>
          <td class="addr-cell"><a href="${link}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${d.address || '—'}</a></td>
          <td>${d.city || '—'}</td>
          <td>${Utils.formatCurrency(d.list_price)}</td>
          <td>${priceChangeHtml}</td>
          <td>${d.hoa_monthly != null ? Utils.formatCurrency(d.hoa_monthly) : '—'}</td>
          <td>${Utils.formatCurrency(d.price_per_sqft)}</td>
          <td>${Utils.formatNumber(d.sqft)}</td>
          <td>${d.beds ?? '—'}</td>
          <td>${d.baths ?? '—'}</td>
          <td>${d.year_built ?? '—'}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('fav-results-table-wrap').innerHTML = `
      <table class="data-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
    `;

    MapUtils.bindSortHeaders('#fav-results-table-wrap .sortable', this._sort, ['address', 'favorited_at'],
      () => { Prefs.set('fav.sort', { col: this._sort.col, asc: this._sort.asc }); this._renderResults(this._items); });

    document.querySelectorAll('#fav-results-table-wrap .btn-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const addr = btn.dataset.favAddr;
        FavoritesStore.remove(addr, 'buy');
        this._updateTabCount();
        this._renderAll();
      });
    });

    MapUtils.bindTableMarkerHovers({
      rows: '#fav-results-table-wrap .clickable-row',
      items: items.map(i => i.data),
      markersByAddr: this._markersByAddr,
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
      onRowClick: (h) => this._showDetail(h, items),
    });
  },

  _showDetail(listing, items) {
    const item = items.find(i => i.data.address === listing.address);
    if (!item) return;
    const d = item.data;
    const photos = d.photo_urls && d.photo_urls.length
      ? d.photo_urls : (d.photo_url ? [d.photo_url] : []);

    const statusBadge = item.delisted
      ? `<span class="badge badge-delisted">DELISTED</span>`
      : '<span class="badge badge-active">ACTIVE</span>';

    const priceDropInfo = (d.price_change && d.price_change < 0)
      ? `<div class="metric">
           <span class="metric-label">Price Drops</span>
           <span class="metric-value delta-down">${Utils.formatCurrency(d.price_change)}</span>
           <span class="metric-delta">${d.price_drop_count || 1} reduction${(d.price_drop_count || 1) > 1 ? 's' : ''}</span>
         </div>` : '';

    const link = d.listing_url || d.redfin_url || '#';

    document.getElementById('fav-detail-content').innerHTML = `
      <h3>Property Details ${statusBadge}</h3>
      <div class="comp-header">
        <div class="comp-subject">
          ${photos.length > 0 ? MapUtils.compSubjectCarouselHTML(d) : '<div class="comp-subject-carousel no-photos"><div class="no-photo-placeholder">No photos</div></div>'}
          <div class="comp-subject-info">
            <h4><a href="${link}" target="_blank" rel="noopener">${d.address}</a></h4>
            <p>${d.city || ''} ${d.zip_code || ''} · ${d.beds || '?'}bd/${d.baths || '?'}ba · ${Utils.formatNumber(d.sqft)} sqft</p>
            <p class="comp-price">Price: ${Utils.formatCurrency(d.list_price)}</p>
          </div>
        </div>
        <div class="comp-metrics">
          <div class="metric">
            <span class="metric-label">Saved</span>
            <span class="metric-value">${Utils.formatDate(item.favorited_at)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Days Tracked</span>
            <span class="metric-value">${d.days_tracked ?? d.days_on_market ?? '—'}</span>
          </div>
          ${priceDropInfo}
          ${item.delisted ? `<div class="metric">
            <span class="metric-label">Delisted</span>
            <span class="metric-value">${item.delisted_at ? Utils.formatDate(item.delisted_at) : 'Unknown'}</span>
          </div>` : ''}
        </div>
      </div>
    `;

    document.getElementById('fav-detail-card').style.display = 'block';
    document.getElementById('fav-detail-backdrop').style.display = 'block';
    if (photos.length > 0) {
      MapUtils.initCompCarousel(document.querySelector('#fav-detail-content .comp-subject-carousel'), photos);
    }
  },

  _hideDetail() {
    document.getElementById('fav-detail-card').style.display = 'none';
    document.getElementById('fav-detail-backdrop').style.display = 'none';
  },

  _updateTabCount() {
    const count = FavoritesStore.count();
    const badge = document.getElementById('fav-tab-count');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  },

  _showPhoto(listing, x, y) {
    MapUtils.showPhoto(this._photoTooltip, this._photoTimeout, listing, x, y, 'list_price');
  },
  _hidePhoto() { MapUtils.hidePhoto(this._photoTooltip, this._photoTimeout); },
};
