/**
 * Data loader — fetches dashboard_data.json and exposes it globally.
 */

const DataLoader = {
  data: null,

  async load() {
    try {
      const resp = await fetch('../data/dashboard_data.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.data = await resp.json();
      console.log(`Dashboard data loaded: ${this.data.sold_homes.length} homes, ` +
        `${Object.keys(this.data.market_trends).length} market areas`);
      return this.data;
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      document.getElementById('app').innerHTML = `
        <div style="padding:2rem;text-align:center;color:#dc2626;">
          <h2>Could not load data</h2>
          <p>Make sure <code>data/dashboard_data.json</code> exists.<br>
          Run <code>python3 scripts/build_dashboard_data.py</code> to generate it.</p>
          <p style="color:#6b7280;font-size:0.875rem;">Error: ${err.message}</p>
        </div>`;
      return null;
    }
  },
};
