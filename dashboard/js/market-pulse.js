/**
 * Market Pulse tab — time-series charts showing market conditions.
 */

const MarketPulse = {
  _charts: [
    { id: 'chart-price', field: 'median_sale_price', prefix: '$', label: 'Median Sale Price' },
    { id: 'chart-supply', field: 'months_of_supply', refLines: [4, 6], label: 'Months of Supply', note: 'Below 4 = seller\'s market, above 6 = buyer\'s market' },
    { id: 'chart-ratio', field: 'avg_sale_to_list', refLines: [1.0], label: 'Sale-to-List Ratio', note: 'Below 1.0 = buyers have leverage' },
    { id: 'chart-dom', field: 'median_dom', label: 'Median Days on Market' },
    { id: 'chart-inventory', field: 'inventory', label: 'Active Inventory' },
    { id: 'chart-sold', field: 'homes_sold', label: 'Homes Sold (Monthly)' },
  ],

  init(container, data) {
    const trends = data.market_trends;
    const zipAreas = data.zip_areas || [];
    const baselineCity = (data.config && data.config.metro && data.config.metro.baseline_city) || '';
    const trendOptions = Utils.TREND_TYPES.map(t =>
      `<option value="${t}">${Utils.TREND_LABELS[t]}</option>`
    ).join('');

    const chartOverrideOptions = `<option value="global">Global</option>` + trendOptions;

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>Market Pulse</h2>
          <button id="mp-learn-more" class="btn-learn-more" aria-label="Learn more about market pulse" title="Learn more">&#9432;</button>
          ${data.data_freshness && data.data_freshness.market_trends ? `<span class="freshness-badge">Trend data updated ${MapUtils.formatAge(data.data_freshness.market_trends)}</span>` : ''}
        </div>
        <p class="subtitle">Is now a good time to buy? Track key market indicators over time.</p>
      </div>
      <div id="mp-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="mp-modal-close">&times;</button>
          <h3>About Market Pulse Data</h3>
          <p>Market Pulse uses <strong>Redfin's public market tracker data</strong>, which provides monthly aggregated statistics at the city and zip code level. This data is downloaded from Redfin's S3 bulk data files and goes back several years, giving you a long-term view of market trends.</p>
          <p>Key metrics include median sale price, months of supply, sale-to-list ratio, days on market, and price drop rates. These are computed by Redfin across <em>all</em> sales in each area, not just the ~90-day window shown in the other tabs.</p>
          <h4>How is this different from the other tabs?</h4>
          <p>The <strong>Property Explorer</strong> and <strong>Area Compare</strong> tabs show individual recently sold homes (last ~90 days) pulled from Redfin's sold listings API. Market Pulse shows broader market-level trends over time, so you can see whether conditions are improving or worsening for buyers before drilling into individual properties.</p>
          <h4>Data sources</h4>
          <ul>
            <li><strong>City-level trends:</strong> Redfin city market tracker (updated weekly)</li>
            <li><strong>Zip-level trends:</strong> Redfin zip code market tracker (updated monthly)</li>
          </ul>
        </div>
      </div>
      <div class="controls">
        <div class="zipmap-wrap" id="mp-zipmap-wrap">
          <button type="button" class="zipmap-btn" id="mp-zipmap-btn" title="Select areas on map">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            Select using map
          </button>
          <div class="zipmap-popover" id="mp-zipmap-popover">
            <div class="zipmap-header">
              <span>Click zip codes to toggle</span>
              <button type="button" class="zipmap-close" id="mp-zipmap-close">&times;</button>
            </div>
            <div id="mp-zipmap" class="zipmap-container"></div>
          </div>
        </div>
        <div class="trend-control">
          <label for="mp-global-trend">Trend:</label>
          <select id="mp-global-trend">${trendOptions}</select>
        </div>
      </div>
      <div id="buyer-score-card"></div>
      <div class="chart-grid">
        ${this._charts.map(c => `
          <div class="chart-card">
            <div class="chart-card-header">
              <h3>${c.label}</h3>
              <div class="chart-card-controls">
                <label class="chart-june-label"><input type="checkbox" class="chart-june-check" data-chart="${c.id}"> June</label>
                <select class="chart-trend-select" data-chart="${c.id}">${chartOverrideOptions}</select>
              </div>
            </div>
            ${c.note ? `<p class="chart-note">${c.note}</p>` : ''}
            <div id="${c.id}"></div>
          </div>
        `).join('')}
      </div>
    `;

    // Learn More modal
    const modal = document.getElementById('mp-modal');
    document.getElementById('mp-learn-more').addEventListener('click', () => modal.style.display = 'flex');
    document.getElementById('mp-modal-close').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Build the area options list
    this._baselineCity = baselineCity;
    const allAreas = this._buildAreaList(zipAreas, trends);

    // Restore saved active areas, or default to baseline city
    const savedAreas = Prefs.get('mp.activeAreas');
    this._activeAreas = savedAreas
      ? new Set(savedAreas.filter(k => allAreas.some(a => a.key === k)))
      : new Set(trends[baselineCity] ? [baselineCity] : []);

    // Zip map popover
    this._initZipMap(allAreas, trends);

    // Global trend select
    const globalSelect = document.getElementById('mp-global-trend');
    globalSelect.value = Prefs.get('mp.globalTrend', 'off');
    globalSelect.addEventListener('change', () => {
      Prefs.set('mp.globalTrend', globalSelect.value);
      this._renderCharts(trends, allAreas);
    });

    // Per-chart trend selects
    container.querySelectorAll('.chart-trend-select').forEach(sel => {
      const chartId = sel.dataset.chart;
      sel.value = Prefs.get(`mp.chartTrends.${chartId}`, 'global');
      sel.addEventListener('change', () => {
        Prefs.set(`mp.chartTrends.${chartId}`, sel.value);
        this._renderCharts(trends, allAreas);
      });
    });

    // Per-chart June marker checkboxes
    container.querySelectorAll('.chart-june-check').forEach(chk => {
      const chartId = chk.dataset.chart;
      chk.checked = Prefs.get(`mp.juneMarkers.${chartId}`, false);
      chk.addEventListener('change', () => {
        Prefs.set(`mp.juneMarkers.${chartId}`, chk.checked);
        this._renderCharts(trends, allAreas);
      });
    });

    this._renderCharts(trends, allAreas);
    this._renderBuyerScore(trends, allAreas);
  },

  _buildAreaList(zipAreas, trends) {
    const areas = [];
    let colorIdx = 0;

    // Metro baseline city
    const bc = this._baselineCity;
    if (bc && trends[bc]) {
      areas.push({
        key: bc,
        label: `${bc} (Metro)`,
        color: Utils.baselineColor,
        dash: 'solid',
      });
    }

    // All zip areas from the data
    zipAreas.forEach(za => {
      if (!trends[za.key]) return;
      const label = za.city ? `${za.city} (${za.zip})` : za.zip;
      areas.push({
        key: za.key,
        label,
        color: Utils.colorFor(colorIdx),
        dash: 'solid',
      });
      colorIdx++;
    });

    return areas;
  },

  _initZipMap(allAreas, trends) {
    const btn = document.getElementById('mp-zipmap-btn');
    const popover = document.getElementById('mp-zipmap-popover');
    const closeBtn = document.getElementById('mp-zipmap-close');
    let map = null;
    let geoLayer = null;

    // Build key->area lookup
    const areaByKey = {};
    allAreas.forEach(a => { areaByKey[a.key] = a; });

    const styleFor = (zipKey) => {
      const active = this._activeAreas.has(zipKey);
      const area = areaByKey[zipKey];
      return {
        color: area ? area.color : '#6b7280',
        weight: active ? 2 : 1,
        fillColor: area ? area.color : '#9ca3af',
        fillOpacity: active ? 0.45 : 0.08,
      };
    };

    const syncMapStyles = () => {
      if (!geoLayer) return;
      geoLayer.eachLayer(layer => {
        const zipKey = layer.feature.properties._zipKey;
        if (zipKey) layer.setStyle(styleFor(zipKey));
      });
    };

    // Store syncMapStyles so the multi-select can call it
    this._syncMapStyles = syncMapStyles;

    const openMap = () => {
      popover.classList.add('open');
      if (map) {
        setTimeout(() => map.invalidateSize(), 50);
        syncMapStyles();
        return;
      }

      // Create the map
      map = L.map('mp-zipmap', {
        zoomControl: true,
        attributionControl: false,
      });
      L.tileLayer(MapUtils.TILE_URL, {
        maxZoom: 13,
      }).addTo(map);

      // Load GeoJSON (shared cache with score map)
      MapUtils.loadGeoJSON()
        .then(geojson => {
          geoLayer = L.geoJSON(geojson, {
            style: (feature) => {
              const zip = feature.properties.ZCTA5;
              const zipKey = `Zip Code: ${zip}`;
              feature.properties._zipKey = zipKey;
              return styleFor(zipKey);
            },
            onEachFeature: (feature, layer) => {
              const zip = feature.properties.ZCTA5;
              const zipKey = `Zip Code: ${zip}`;
              const area = areaByKey[zipKey];
              const label = area ? area.label : zip;

              layer.bindTooltip(label, { sticky: true, className: 'zipmap-tooltip' });

              layer.on('click', () => {
                if (this._activeAreas.has(zipKey)) {
                  if (this._activeAreas.size <= 1) return;
                  this._activeAreas.delete(zipKey);
                } else {
                  this._activeAreas.add(zipKey);
                }
                Prefs.set('mp.activeAreas', [...this._activeAreas]);
                syncMapStyles();
                this._renderCharts(trends, allAreas);
                this._renderBuyerScore(trends, allAreas);
              });
            },
          }).addTo(map);

          map.fitBounds(geoLayer.getBounds(), { padding: [10, 10] });
        });
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (popover.classList.contains('open')) {
        popover.classList.remove('open');
      } else {
        openMap();
      }
    });

    closeBtn.addEventListener('click', () => popover.classList.remove('open'));

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#mp-zipmap-wrap')) {
        popover.classList.remove('open');
      }
    });
  },

  _syncMapStyles() { /* set by _initZipMap */ },

  _renderCharts(trends, allAreas) {
    const globalTrend = Prefs.get('mp.globalTrend', 'off');

    this._charts.forEach(chart => {
      const chartTrend = Utils.resolveTrend(
        globalTrend,
        Prefs.get(`mp.chartTrends.${chart.id}`, 'global')
      );
      const juneMarker = Prefs.get(`mp.juneMarkers.${chart.id}`, false);
      const traces = [];

      allAreas.forEach(area => {
        if (!this._activeAreas.has(area.key)) return;
        const records = trends[area.key] || [];
        if (records.length === 0) return;

        const xVals = records.map(r => r.date);
        const yVals = records.map(r => r[chart.field]);

        traces.push({
          x: xVals,
          y: yVals,
          name: area.label,
          type: 'scatter',
          mode: 'lines',
          line: { color: area.color, dash: area.dash, width: 1.5 },
          connectgaps: true,
          opacity: chartTrend !== 'off' ? 0.2 : 1,
        });

        Utils.buildTrendTraces(xVals, yVals, chartTrend, area.color)
          .forEach(t => traces.push(t));

        if (juneMarker) {
          const juneX = [], juneY = [];
          for (let i = 0; i < xVals.length; i++) {
            if (yVals[i] != null && !isNaN(yVals[i]) && xVals[i] && xVals[i].includes('-06-')) {
              juneX.push(xVals[i]);
              juneY.push(yVals[i]);
            }
          }
          if (juneX.length > 0) {
            traces.push({
              x: juneX,
              y: juneY,
              mode: 'markers',
              type: 'scatter',
              marker: { color: '#dc2626', size: 8, symbol: 'circle' },
              showlegend: false,
              hoverinfo: 'skip',
            });
          }
        }
      });

      const shapes = (chart.refLines || []).map(val => ({
        type: 'line',
        x0: 0, x1: 1, xref: 'paper',
        y0: val, y1: val,
        line: { color: '#9ca3af', width: 1, dash: 'dot' },
      }));

      const layout = {
        ...Utils.plotlyDefaults,
        shapes,
        yaxis: {
          ...Utils.plotlyDefaults.yaxis,
          tickprefix: chart.prefix || '',
        },
      };

      Plotly.newPlot(chart.id, traces, layout, { responsive: true, displayModeBar: false });
    });
  },

  _computeScore(records) {
    if (!records || records.length === 0) return null;
    const recent = records.slice(-3);
    const avgSupply = Utils.median(recent.map(r => r.months_of_supply));
    const avgRatio = Utils.median(recent.map(r => r.avg_sale_to_list));
    const avgDOM = Utils.median(recent.map(r => r.median_dom));
    const avgPriceDrops = Utils.median(recent.map(r => r.price_drops));

    const supplyScore = Math.min(100, Math.max(0, ((avgSupply || 3) - 2) / 4 * 100));
    const ratioScore = Math.min(100, Math.max(0, (1.03 - (avgRatio || 1)) / 0.06 * 100));
    const domScore = Math.min(100, Math.max(0, ((avgDOM || 30) - 14) / 31 * 100));
    const dropScore = Math.min(100, Math.max(0, ((avgPriceDrops || 0.2) - 0.1) / 0.2 * 100));

    const composite = Math.round((supplyScore + ratioScore + domScore + dropScore) / 4);

    let label, colorClass;
    if (composite >= 60) { label = "Buyer's Market"; colorClass = 'score-good'; }
    else if (composite >= 40) { label = 'Balanced'; colorClass = 'score-neutral'; }
    else { label = "Seller's Market"; colorClass = 'score-bad'; }

    return { composite, label, colorClass, avgSupply, avgRatio, avgDOM, avgPriceDrops, supplyScore, ratioScore, domScore, dropScore };
  },

  _computeScoreAt(records, monthsAgo) {
    if (!records || records.length === 0) return null;
    const endIdx = records.length - monthsAgo;
    if (endIdx <= 0) return null;
    return this._computeScore(records.slice(0, endIdx));
  },

  _getHistorical(records, monthsAgo) {
    if (!records || records.length === 0) return null;
    const idx = records.length - 1 - monthsAgo;
    if (idx < 0) return null;
    const r = records[idx];
    return {
      supply: r.months_of_supply,
      ratio: r.avg_sale_to_list,
      dom: r.median_dom,
      drops: r.price_drops,
    };
  },

  _fmtHist(val, type) {
    if (val == null) return '\u2014';
    if (type === 'ratio') return val.toFixed(3);
    if (type === 'pct') return (val * 100).toFixed(0) + '%';
    if (type === 'int') return Math.round(val).toString();
    return val.toFixed(1);
  },

  _histVals(records, field, fmt, monthsAgoList) {
    return monthsAgoList.map(m => {
      const h = this._getHistorical(records, m);
      const val = h ? h[field] : null;
      return `<span class="hist-val" title="${m}mo ago">${this._fmtHist(val, fmt)}</span>`;
    }).join('');
  },

  _renderScoreCard(s, title, showBreakdown, records) {
    if (!s) return '';
    const periods = [3, 6, 12, 24];
    const hasHist = showBreakdown && records && records.length > 0;
    const histHeader = hasHist
      ? `<span class="hist-header">${periods.map(m => `<span class="hist-label">${m}mo</span>`).join('')}</span>`
      : '';

    return `
      <div class="score-card">
        <h3>${title}</h3>
        <div class="score-row">
          <div class="score-value ${s.colorClass}">${s.composite}</div>
          <div class="score-label">${s.label}</div>
        </div>
        ${showBreakdown ? `
        ${hasHist ? `<div class="score-item score-item-header"><span></span><span>Now</span><span class="hist-vals">${periods.map(m => `<span class="hist-val">${m}mo</span>`).join('')}</span><span></span></div>` : ''}
        <div class="score-breakdown">
          <div class="score-item score-item-composite">
            <span>Buyer Favorability</span>
            <span class="${s.colorClass}">${s.composite}</span>
            ${hasHist ? `<span class="hist-vals">${periods.map(m => { const hs = this._computeScoreAt(records, m); return `<span class="hist-val ${hs ? hs.colorClass : ''}">${hs ? hs.composite : '\u2014'}</span>`; }).join('')}</span>` : ''}
            <span></span>
          </div>
          <div class="score-item">
            <span>Months of Supply <span class="info-icon" data-tooltip="How many months it would take to sell all current listings at the current sales pace. Above 6 months favors buyers (more choices, less competition). Below 4 months favors sellers. Score: 0 at 2 months, 100 at 6+ months.">i</span></span>
            <span>${s.avgSupply != null ? s.avgSupply.toFixed(1) : '\u2014'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'supply', 'dec', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.supplyScore}%;background:${s.supplyScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
          <div class="score-item">
            <span>Sale-to-List Ratio <span class="info-icon" data-tooltip="Average ratio of final sale price to original list price. Below 1.0 means homes sell under asking — buyers have negotiating power. Above 1.0 means bidding wars. Score: 100 at 0.97, 0 at 1.03+.">i</span></span>
            <span>${s.avgRatio != null ? s.avgRatio.toFixed(3) : '\u2014'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'ratio', 'ratio', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.ratioScore}%;background:${s.ratioScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
          <div class="score-item">
            <span>Days on Market <span class="info-icon" data-tooltip="Median number of days homes sit on the market before selling. Higher means less urgency and more time to decide — good for buyers. Lower means homes sell fast — competitive for buyers. Score: 0 at 14 days, 100 at 45+ days.">i</span></span>
            <span>${s.avgDOM != null ? Math.round(s.avgDOM) : '\u2014'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'dom', 'int', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.domScore}%;background:${s.domScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
          <div class="score-item">
            <span>Price Drop Rate <span class="info-icon" data-tooltip="Fraction of listings that had at least one price reduction. Higher means sellers are having to cut prices to attract buyers — a sign of buyer leverage. Score: 0 at 10%, 100 at 30%+.">i</span></span>
            <span>${s.avgPriceDrops != null ? (s.avgPriceDrops * 100).toFixed(0) + '%' : '\u2014'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'drops', 'pct', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.dropScore}%;background:${s.dropScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
        </div>
        <p class="score-note">Based on most recent 3 months of data. Score 0-100; higher = more favorable for buyers.</p>
        ` : ''}
      </div>
    `;
  },

  _renderBuyerScore(trends, allAreas) {
    const container = document.getElementById('buyer-score-card');

    // Metro score with full breakdown + history
    const bc = this._baselineCity;
    const baseRecords = (bc && trends[bc]) || [];
    const metroHtml = this._renderScoreCard(
      this._computeScore(baseRecords),
      `Buyer Favorability Score (${bc || 'Metro'})`,
      true,
      baseRecords
    );

    // Per-area scores (compact — no breakdown)
    const periods = [3, 6, 12, 24];
    const areaScores = allAreas
      .filter(a => a.key !== bc && this._activeAreas.has(a.key) && trends[a.key] && trends[a.key].length > 0)
      .map(a => ({ area: a, score: this._computeScore(trends[a.key]), records: trends[a.key] }))
      .filter(s => s.score);

    // Clean up previous score map instance before replacing DOM
    if (this._scoreMap) {
      this._scoreMap.remove();
      this._scoreMap = null;
    }
    if (this._scoreTooltipEl) {
      this._scoreTooltipEl.remove();
      this._scoreTooltipEl = null;
    }

    let areaHtml = '';
    if (areaScores.length > 0) {
      areaHtml = `
        <div class="score-card score-card-map">
          <h3>Per-ZIP Scores</h3>
          <div id="mp-score-map" class="score-map-container"></div>
        </div>
      `;
    }

    container.innerHTML = `<div class="score-row-wrap">${metroHtml}${areaHtml}</div>`;
    if (areaScores.length > 0) {
      this._renderScoreMap(trends, allAreas);
    }
  },

  _scoreMap: null,

  _renderScoreMap(trends, allAreas) {
    const container = document.getElementById('mp-score-map');
    if (!container) return;

    const areaByKey = {};
    allAreas.forEach(a => { areaByKey[a.key] = a; });

    // Build score data for active non-metro zip areas
    const scoreData = {};
    allAreas.forEach(a => {
      if (a.key === this._baselineCity || !this._activeAreas.has(a.key)) return;
      const records = trends[a.key];
      if (records && records.length > 0) {
        scoreData[a.key] = { score: this._computeScore(records), records };
      }
    });

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false,
    });
    L.tileLayer(MapUtils.TILE_URL, { maxZoom: 13 }).addTo(map);
    this._scoreMap = map;

    // Portal tooltip — appended to body so it isn't clipped by the map container
    const tooltip = document.createElement('div');
    tooltip.className = 'score-map-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
    this._scoreTooltipEl = tooltip;

    const periods = [3, 6, 12, 24];

    MapUtils.loadGeoJSON().then(geojson => {
      const activeBounds = [];

      const geoLayer = L.geoJSON(geojson, {
        style: (feature) => {
          const zip = feature.properties.ZCTA5;
          const zipKey = `Zip Code: ${zip}`;
          feature.properties._zipKey = zipKey;
          const area = areaByKey[zipKey];
          const active = !!scoreData[zipKey];
          return {
            color: active ? area.color : '#9ca3af',
            weight: active ? 2 : 0.5,
            fillColor: active ? area.color : '#d1d5db',
            fillOpacity: active ? 0.3 : 0.04,
          };
        },
        onEachFeature: (feature, layer) => {
          const zipKey = feature.properties._zipKey;
          const sd = scoreData[zipKey];
          if (!sd) return;
          const { score: s, records: r } = sd;
          const area = areaByKey[zipKey];
          const zip = zipKey.replace('Zip Code: ', '');
          const hists = periods.map(m => ({ m, data: this._getHistorical(r, m) }));
          const histRow = (vals) =>
            `<span class="ast-hist-vals">${hists.map(h => `<span class="ast-hist-val">${vals(h.data)}</span>`).join('')}</span>`;

          layer.on('mouseover', () => {
            layer.setStyle({ fillOpacity: 0.55, weight: 3 });
            tooltip.innerHTML = `
              <div class="smt-header">
                <span class="smt-zip">${zip}</span>
                <span class="smt-score ${s.colorClass}">${s.composite}</span>
                <span class="smt-label">${s.label}</span>
              </div>
              <div class="ast-row ast-header"><span></span><span>Now</span><span class="ast-hist-vals">${periods.map(m => `<span class="ast-hist-val">${m}mo</span>`).join('')}</span><span></span></div>
              <div class="ast-row ast-composite"><span>Buyer Favorability</span><span class="${s.colorClass}">${s.composite}</span><span class="ast-hist-vals">${hists.map(h => { const hs = this._computeScoreAt(r, h.m); return `<span class="ast-hist-val ${hs ? hs.colorClass : ''}">${hs ? hs.composite : '\u2014'}</span>`; }).join('')}</span><span></span></div>
              <div class="ast-row"><span>Months of Supply</span><span>${s.avgSupply != null ? s.avgSupply.toFixed(1) : '\u2014'}</span>${histRow(d => this._fmtHist(d?.supply, 'dec'))}<div class="score-bar"><div class="score-fill" style="width:${s.supplyScore}%;background:${s.supplyScore>50?'#16a34a':'#dc2626'}"></div></div></div>
              <div class="ast-row"><span>Sale-to-List</span><span>${s.avgRatio != null ? s.avgRatio.toFixed(3) : '\u2014'}</span>${histRow(d => this._fmtHist(d?.ratio, 'ratio'))}<div class="score-bar"><div class="score-fill" style="width:${s.ratioScore}%;background:${s.ratioScore>50?'#16a34a':'#dc2626'}"></div></div></div>
              <div class="ast-row"><span>Days on Market</span><span>${s.avgDOM != null ? Math.round(s.avgDOM) : '\u2014'}</span>${histRow(d => this._fmtHist(d?.dom, 'int'))}<div class="score-bar"><div class="score-fill" style="width:${s.domScore}%;background:${s.domScore>50?'#16a34a':'#dc2626'}"></div></div></div>
              <div class="ast-row"><span>Price Drop Rate</span><span>${s.avgPriceDrops != null ? (s.avgPriceDrops*100).toFixed(0)+'%' : '\u2014'}</span>${histRow(d => this._fmtHist(d?.drops, 'pct'))}<div class="score-bar"><div class="score-fill" style="width:${s.dropScore}%;background:${s.dropScore>50?'#16a34a':'#dc2626'}"></div></div></div>
            `;
            tooltip.style.display = 'block';
          });

          layer.on('mousemove', (e) => {
            const x = e.originalEvent.clientX;
            const y = e.originalEvent.clientY;
            const tw = tooltip.offsetWidth || Math.min(420, window.innerWidth * 0.9);
            const th = tooltip.offsetHeight || 180;
            let left = x + 14;
            let top = y - 10;
            if (left + tw > window.innerWidth - 8) left = x - tw - 14;
            if (left < 4) left = 4;
            if (top < 8) top = 8;
            if (top + th > window.innerHeight - 8) top = window.innerHeight - th - 8;
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
          });

          layer.on('mouseout', () => {
            layer.setStyle({ fillOpacity: 0.3, weight: 2, color: area.color });
            tooltip.style.display = 'none';
          });
        },
      }).addTo(map);

      // Add score markers at polygon centroids
      geoLayer.eachLayer(layer => {
        const zipKey = layer.feature.properties._zipKey;
        const sd = scoreData[zipKey];
        if (!sd) return;
        const { score: s } = sd;
        const centroid = this._featureCentroid(layer.feature);
        if (!centroid) return;
        activeBounds.push(layer.getBounds());
        const bg = s.colorClass === 'score-good' ? '#16a34a' : s.colorClass === 'score-neutral' ? '#ca8a04' : '#dc2626';
        L.marker(centroid, {
          icon: L.divIcon({
            className: '',
            html: `<div class="zip-score-marker" style="background:${bg}">${s.composite}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
      });

      if (activeBounds.length > 0) {
        map.fitBounds(activeBounds.reduce((a, b) => a.extend(b)), { padding: [24, 24] });
      } else {
        map.fitBounds(geoLayer.getBounds(), { padding: [10, 10] });
      }
    });
  },

  _featureCentroid(feature) {
    const coords = feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat(2)
      : feature.geometry.coordinates.flat(1);
    if (!coords.length) return null;
    return [
      coords.reduce((s, c) => s + c[1], 0) / coords.length,
      coords.reduce((s, c) => s + c[0], 0) / coords.length,
    ];
  },
};
