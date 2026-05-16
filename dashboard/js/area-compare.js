/**
 * Area Compare tab — side-by-side comparison of focus areas.
 */

const AreaCompare = {
  _scatterCharts: [
    { id: 'chart-price-sqft', label: 'Price vs. Square Footage', note: 'Each dot is a recent sale. Where do you get the most space for your money?' },
    { id: 'chart-price-year', label: 'Price vs. Year Built', note: 'See how sale prices vary by construction year across areas.' },
  ],

  init(container, data) {
    const config = data.config;
    const summary = data.area_summary;
    const homes = data.sold_homes;
    const focusAreas = config.focus_areas;

    const trendOptions = Utils.TREND_TYPES.map(t =>
      `<option value="${t}">${Utils.TREND_LABELS[t]}</option>`
    ).join('');

    const chartOverrideOptions = `<option value="global">Global</option>` + trendOptions;

    const dateRangeNote = (() => {
      const dates = homes.map(h => h.sold_date).filter(Boolean).sort();
      if (dates.length === 0) return '';
      const fmt = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return `Showing sales from ${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
    })();

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>Area Compare</h2>
          <button id="ac-learn-more" class="btn-learn-more" aria-label="Learn more about area compare" title="Learn more">&#9432;</button>
          ${data.data_freshness && data.data_freshness.sold_homes ? `<span class="freshness-badge">Sold data updated ${this._formatAge(data.data_freshness.sold_homes)}</span>` : ''}
        </div>
        <p class="subtitle">Compare your focus areas side by side on price, size, and value.</p>
      </div>
      <div id="ac-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="ac-modal-close">&times;</button>
          <h3>About Area Compare Data</h3>
          <p>Area Compare shows <strong>side-by-side statistics for your focus areas</strong>, computed from the same recently sold homes (~90 days) used in the Property Explorer.</p>
          <h4>Summary table</h4>
          <p>The table at the top shows median price, price per square foot, square footage, lot size, beds, days on market, year built, and price range for each area. These are computed during the data build step from all sold homes matching each area's boundary.</p>
          <h4>Scatter plots</h4>
          <p><strong>Price vs. Square Footage</strong> shows where you get the most space for your money across areas. <strong>Price vs. Year Built</strong> shows how sale prices vary by construction year — useful for spotting premium pricing on newer builds or value in older homes.</p>
          <h4>Area filtering</h4>
          <p>For city-type areas (Summerfield, Oak Ridge), homes are matched by city name. For neighborhood-type areas (Irving Park, Sunset Hills), homes are matched using <strong>polygon boundaries</strong> — only homes with coordinates inside the defined boundary are included.</p>
          <h4>Data sources</h4>
          <ul>
            <li><strong>Sale data:</strong> Redfin sold listings API (last ~90 days)</li>
          </ul>
        </div>
      </div>
      ${dateRangeNote ? `<p class="date-range-note">${dateRangeNote}</p>` : ''}
      <div id="compare-table-wrap"></div>
      <div class="controls">
        <div class="trend-control">
          <label for="ac-global-trend">Trend:</label>
          <select id="ac-global-trend">${trendOptions}</select>
        </div>
      </div>
      <div class="chart-grid">
        <div class="chart-card">
          <h3>Median Sale Price by Area</h3>
          <div id="chart-area-price"></div>
        </div>
        <div class="chart-card">
          <h3>Price per Sq Ft by Area</h3>
          <div id="chart-area-ppsf"></div>
        </div>
        ${this._scatterCharts.map(c => `
          <div class="chart-card">
            <div class="chart-card-header">
              <h3>${c.label}</h3>
              <select class="chart-trend-select" data-chart="${c.id}">${chartOverrideOptions}</select>
            </div>
            ${c.note ? `<p class="chart-note">${c.note}</p>` : ''}
            <div id="${c.id}"></div>
          </div>
        `).join('')}
      </div>
    `;

    // Learn More modal
    const acModal = document.getElementById('ac-modal');
    document.getElementById('ac-learn-more').addEventListener('click', () => acModal.style.display = 'flex');
    document.getElementById('ac-modal-close').addEventListener('click', () => acModal.style.display = 'none');
    acModal.addEventListener('click', (e) => { if (e.target === acModal) acModal.style.display = 'none'; });

    // Global trend select
    const globalSelect = document.getElementById('ac-global-trend');
    globalSelect.value = Prefs.get('ac.globalTrend', 'off');
    globalSelect.addEventListener('change', () => {
      Prefs.set('ac.globalTrend', globalSelect.value);
      this._renderScatter(homes, focusAreas);
      this._renderPriceVsYear(homes, focusAreas);
    });

    // Per-chart trend selects
    container.querySelectorAll('.chart-trend-select').forEach(sel => {
      const chartId = sel.dataset.chart;
      sel.value = Prefs.get(`ac.chartTrends.${chartId}`, 'global');
      sel.addEventListener('change', () => {
        Prefs.set(`ac.chartTrends.${chartId}`, sel.value);
        if (chartId === 'chart-price-sqft') this._renderScatter(homes, focusAreas);
        else this._renderPriceVsYear(homes, focusAreas);
      });
    });

    this._renderTable(summary, focusAreas);
    this._renderBarCharts(summary, focusAreas);
    this._renderScatter(homes, focusAreas);
    this._renderPriceVsYear(homes, focusAreas);
  },

  _formatAge(isoString) {
    try {
      const then = new Date(isoString);
      const now = new Date();
      const hours = Math.floor((now - then) / 3600000);
      if (hours < 1) return 'just now';
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch { return 'unknown'; }
  },

  _renderTable(summary, focusAreas) {
    const areas = focusAreas.filter(fa => summary[fa.name]);
    if (areas.length === 0) {
      document.getElementById('compare-table-wrap').innerHTML =
        '<p class="empty-state">No area summary data available yet.</p>';
      return;
    }

    const rows = areas.map(fa => {
      const s = summary[fa.name];
      return `<tr>
        <td class="area-name">${fa.name}</td>
        <td>${s.count}</td>
        <td>${Utils.formatCurrency(s.median_price)}</td>
        <td>${Utils.formatCurrency(s.median_ppsf)}</td>
        <td>${Utils.formatNumber(s.median_sqft)}</td>
        <td>${Utils.formatNumber(s.median_lot_sqft)}</td>
        <td>${s.median_beds != null ? Math.round(s.median_beds) : '—'}</td>
        <td>${s.median_dom != null ? Math.round(s.median_dom) : '—'}</td>
        <td>${s.median_year_built != null ? Math.round(s.median_year_built) : '—'}</td>
        <td>${s.price_range ? Utils.formatCurrency(s.price_range[0]) + ' – ' + Utils.formatCurrency(s.price_range[1]) : '—'}</td>
      </tr>`;
    });

    document.getElementById('compare-table-wrap').innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Area</th><th>Sales</th><th>Median Price</th><th>$/SqFt</th>
            <th>Sq Ft</th><th>Lot (sqft)</th><th>Beds</th><th>DOM</th>
            <th>Year Built</th><th>Price Range</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  },

  _renderBarCharts(summary, focusAreas) {
    const areas = focusAreas.filter(fa => summary[fa.name]);
    const names = areas.map(fa => fa.name);
    const colors = areas.map((_, i) => Utils.colorFor(i));

    Plotly.newPlot('chart-area-price', [{
      x: names,
      y: names.map(n => summary[n].median_price),
      type: 'bar',
      marker: { color: colors },
      text: names.map(n => Utils.formatCurrency(summary[n].median_price)),
      textposition: 'outside',
    }], {
      ...Utils.plotlyDefaults,
      yaxis: { ...Utils.plotlyDefaults.yaxis, tickprefix: '$' },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });

    Plotly.newPlot('chart-area-ppsf', [{
      x: names,
      y: names.map(n => summary[n].median_ppsf),
      type: 'bar',
      marker: { color: colors },
      text: names.map(n => Utils.formatCurrency(summary[n].median_ppsf)),
      textposition: 'outside',
    }], {
      ...Utils.plotlyDefaults,
      yaxis: { ...Utils.plotlyDefaults.yaxis, tickprefix: '$' },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });
  },

  _renderScatter(homes, focusAreas) {
    const globalTrend = Prefs.get('ac.globalTrend', 'off');
    const chartTrend = Utils.resolveTrend(
      globalTrend,
      Prefs.get('ac.chartTrends.chart-price-sqft', 'global')
    );
    const traces = [];

    focusAreas.forEach((fa, i) => {
      const filtered = Utils.filterByArea(homes, fa)
        .filter(h => h.sqft && h.sale_price);
      if (filtered.length === 0) return;

      const xVals = filtered.map(h => h.sqft);
      const yVals = filtered.map(h => h.sale_price);

      // For scatter plots, only linear makes sense (MA needs ordered sequential data)
      const effectiveTrend = chartTrend.startsWith('ma') ? 'linear' : chartTrend;

      traces.push({
        x: xVals,
        y: yVals,
        text: filtered.map(h =>
          `${h.address}<br>${h.beds}bd/${h.baths}ba<br>${Utils.formatCurrency(h.sale_price)}`
        ),
        name: fa.name,
        type: 'scatter',
        mode: 'markers',
        marker: { color: Utils.colorFor(i), size: 7, opacity: effectiveTrend !== 'off' ? 0.25 : 0.7 },
        hovertemplate: '%{text}<extra></extra>',
      });
      Utils.buildTrendTraces(xVals, yVals, effectiveTrend, Utils.colorFor(i))
        .forEach(t => traces.push(t));
    });

    Plotly.newPlot('chart-price-sqft', traces, {
      ...Utils.plotlyDefaults,
      xaxis: { gridcolor: '#e5e7eb', type: 'linear', title: 'Square Feet' },
      yaxis: { gridcolor: '#e5e7eb', type: 'linear', title: 'Sale Price', tickprefix: '$' },
    }, { responsive: true, displayModeBar: false });
  },

  _renderPriceVsYear(homes, focusAreas) {
    const globalTrend = Prefs.get('ac.globalTrend', 'off');
    const chartTrend = Utils.resolveTrend(
      globalTrend,
      Prefs.get('ac.chartTrends.chart-price-year', 'global')
    );
    const traces = [];

    focusAreas.forEach((fa, i) => {
      const filtered = Utils.filterByArea(homes, fa)
        .filter(h => h.year_built && h.sale_price);
      if (filtered.length === 0) return;

      const xVals = filtered.map(h => h.year_built);
      const yVals = filtered.map(h => h.sale_price);

      const effectiveTrend = chartTrend.startsWith('ma') ? 'linear' : chartTrend;

      traces.push({
        x: xVals,
        y: yVals,
        text: filtered.map(h =>
          `${h.address}<br>Built: ${h.year_built}<br>Sold: ${Utils.formatCurrency(h.sale_price)}`
        ),
        name: fa.name,
        type: 'scatter',
        mode: 'markers',
        marker: { color: Utils.colorFor(i), size: 7, opacity: effectiveTrend !== 'off' ? 0.25 : 0.7 },
        hovertemplate: '%{text}<extra></extra>',
      });
      Utils.buildTrendTraces(xVals, yVals, effectiveTrend, Utils.colorFor(i))
        .forEach(t => traces.push(t));
    });

    Plotly.newPlot('chart-price-year', traces, {
      ...Utils.plotlyDefaults,
      xaxis: { gridcolor: '#e5e7eb', type: 'linear', title: 'Year Built' },
      yaxis: { gridcolor: '#e5e7eb', type: 'linear', title: 'Sale Price', tickprefix: '$' },
    }, { responsive: true, displayModeBar: false });
  },
};
