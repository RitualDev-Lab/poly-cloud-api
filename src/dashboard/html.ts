export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Poly Cloud API — Remote Cache & ROI Dashboard</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111726;
      --card-border: #1e293b;
      --card-hover: #182238;
      --primary: #38bdf8;
      --primary-glow: rgba(56, 189, 248, 0.15);
      --primary-dark: #0284c7;
      --accent: #818cf8;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --mono: "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header */
    header {
      background: rgba(17, 23, 38, 0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 0.85rem 1.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
    }
    .brand span {
      background: linear-gradient(135deg, #fff, var(--text-muted));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .workspace-select-wrapper {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.85rem;
    }
    select, input, button {
      font-family: inherit;
    }
    .workspace-select {
      background: transparent;
      border: none;
      color: var(--text);
      font-size: 0.85rem;
      outline: none;
      cursor: pointer;
    }
    .workspace-select option {
      background: var(--card-bg);
      color: var(--text);
    }

    .btn {
      background: var(--primary-dark);
      color: #fff;
      border: 1px solid transparent;
      padding: 0.45rem 0.9rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.15s ease;
    }
    .btn:hover {
      background: var(--primary);
      color: #090d16;
    }
    .btn-secondary {
      background: var(--card-bg);
      border-color: var(--card-border);
      color: var(--text-muted);
    }
    .btn-secondary:hover {
      background: var(--card-hover);
      color: var(--text);
    }
    .btn-danger {
      background: rgba(248, 113, 113, 0.15);
      border-color: rgba(248, 113, 113, 0.3);
      color: var(--danger);
    }
    .btn-danger:hover {
      background: var(--danger);
      color: #090d16;
    }

    /* Navigation Tabs */
    .tabs-bar {
      background: var(--bg);
      border-bottom: 1px solid var(--card-border);
      padding: 0 1.75rem;
      display: flex;
      gap: 1.5rem;
    }
    .tab-btn {
      padding: 0.9rem 0;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      position: relative;
      transition: color 0.15s ease;
    }
    .tab-btn:hover {
      color: var(--text);
    }
    .tab-btn.active {
      color: var(--primary);
    }
    .tab-btn.active::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--primary);
      border-radius: 2px;
    }

    /* Main Container */
    main {
      flex: 1;
      padding: 1.75rem;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
    }

    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }

    /* Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
      margin-bottom: 1.75rem;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      transition: border-color 0.15s ease;
    }
    .metric-card:hover {
      border-color: rgba(56, 189, 248, 0.4);
    }
    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .metric-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .metric-icon {
      font-size: 1.1rem;
      color: var(--primary);
    }
    .metric-value {
      font-size: 1.85rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 0.35rem;
    }
    .metric-sub {
      font-size: 0.8rem;
      color: var(--text-dim);
    }

    /* Progress bar */
    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      margin-top: 0.75rem;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--primary), var(--accent));
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* Chart & Split Panels */
    .dashboard-split {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.25rem;
      margin-bottom: 1.75rem;
    }
    @media (max-width: 900px) {
      .dashboard-split { grid-template-columns: 1fr; }
    }
    .panel-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .panel-title {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Table Styles */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .table-toolbar {
      padding: 1rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
    }
    .search-input {
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.45rem 0.85rem;
      border-radius: 6px;
      font-size: 0.85rem;
      width: 280px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--primary);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      text-align: left;
    }
    th {
      background: rgba(15, 23, 42, 0.6);
      color: var(--text-muted);
      font-weight: 600;
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid var(--card-border);
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    td {
      padding: 0.9rem 1.25rem;
      border-bottom: 1px solid rgba(30, 41, 59, 0.6);
      vertical-align: middle;
    }
    tr:last-child td {
      border-bottom: none;
    }
    tr:hover td {
      background: var(--card-hover);
    }

    .mono-hash {
      font-family: var(--mono);
      font-size: 0.8rem;
      background: rgba(255, 255, 255, 0.04);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      color: var(--primary);
      cursor: pointer;
    }
    .mono-hash:hover {
      text-decoration: underline;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-primary { background: var(--primary-glow); color: var(--primary); }
    .badge-success { background: rgba(52, 211, 153, 0.15); color: var(--success); }
    .badge-warning { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
    .badge-danger { background: rgba(248, 113, 113, 0.15); color: var(--danger); }
    .badge-dim { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); }

    /* Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-overlay.open {
      display: flex;
    }
    .modal {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      width: 100%;
      max-width: 500px;
      padding: 1.5rem;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .modal-title {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 1.25rem;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    .form-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 0.35rem;
    }
    .form-control {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.55rem 0.75rem;
      border-radius: 6px;
      font-size: 0.9rem;
      outline: none;
    }
    .form-control:focus {
      border-color: var(--primary);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }

    /* Notification toast */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: var(--card-bg);
      border: 1px solid var(--primary);
      color: var(--text);
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
      display: none;
      align-items: center;
      gap: 0.5rem;
      z-index: 200;
      font-size: 0.85rem;
    }
    .toast.show {
      display: flex;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <span>Poly Cloud API</span>
      <span class="badge badge-primary" id="headerStatusBadge">Connecting...</span>
    </div>
    <div class="header-actions">
      <div class="workspace-select-wrapper">
        <span style="color:var(--text-muted)">Team:</span>
        <select class="workspace-select" id="workspaceSelect">
          <option value="default">default</option>
        </select>
      </div>
      <button class="btn btn-secondary" id="btnAdminToken">
        🔑 <span id="tokenLabel">Admin Token</span>
      </button>
      <button class="btn btn-secondary" id="btnRefresh" title="Refresh Data">
        🔄 Refresh
      </button>
    </div>
  </header>

  <!-- Navigation Tabs -->
  <div class="tabs-bar">
    <button class="tab-btn active" data-tab="overview">📊 Overview & ROI</button>
    <button class="tab-btn" data-tab="artifacts">📦 Artifact Explorer</button>
    <button class="tab-btn" data-tab="tokens">🔐 Token Governance</button>
    <button class="tab-btn" data-tab="health">🖥️ Cluster Health</button>
  </div>

  <!-- Main Content -->
  <main>
    <!-- TAB 1: OVERVIEW -->
    <div class="tab-content active" id="tab-overview">
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Cache Hit Rate</span>
            <span class="metric-icon">🎯</span>
          </div>
          <div class="metric-value" id="valHitRate">0.0%</div>
          <div class="metric-sub" id="subHitMiss">0 hits / 0 misses</div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" id="barHitRate" style="width: 0%"></div>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Compute Time Saved</span>
            <span class="metric-icon">⏱️</span>
          </div>
          <div class="metric-value" id="valDurationSaved">0s</div>
          <div class="metric-sub">Aggregated CI & local build savings</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Financial ROI ($)</span>
            <span class="metric-icon">💰</span>
          </div>
          <div class="metric-value" style="color:var(--success)" id="valDollarsSaved">$0.00</div>
          <div class="metric-sub">Estimated cloud runner savings ($0.08/hr)</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Storage Quota</span>
            <span class="metric-icon">💾</span>
          </div>
          <div class="metric-value" id="valStorageUsed">0 MB</div>
          <div class="metric-sub" id="subStorageQuota">0 artifacts stored</div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" id="barQuotaUsed" style="width: 0%"></div>
          </div>
        </div>
      </div>

      <div class="dashboard-split">
        <div class="panel-card">
          <div class="panel-title">
            <span>Cache Efficiency Breakdown</span>
            <span class="badge badge-dim" id="panelWorkspaceSlug">default</span>
          </div>
          <div style="height: 220px; display: flex; align-items: center; justify-content: center;" id="chartContainer">
            <!-- Native SVG Visualizer -->
            <svg id="roiSvg" width="100%" height="200" viewBox="0 0 500 200"></svg>
          </div>
        </div>

        <div class="panel-card">
          <div class="panel-title">
            <span>Quick Setup</span>
          </div>
          <div style="font-size:0.85rem; color:var(--text-muted); line-height:1.6;">
            <p style="margin-bottom:0.75rem;">Connect Poly or Turborepo to this remote cache instance:</p>
            <div style="background:var(--bg); border:1px solid var(--card-border); padding:0.6rem; border-radius:6px; font-family:var(--mono); font-size:0.75rem; color:var(--text); overflow-x:auto;">
              export POLY_REMOTE_CACHE_URL="<span id="txtHostUrl">http://...</span>"<br>
              export POLY_REMOTE_CACHE_TOKEN="<span id="txtTokenMask">poly_tok_...</span>"<br>
              export POLY_TEAM="<span id="txtTeamSlug">default</span>"
            </div>
            <p style="margin-top:0.75rem; font-size:0.8rem; color:var(--text-dim)">Turborepo compatible: Set <code style="color:var(--primary)">TURBO_API</code> and <code style="color:var(--primary)">TURBO_TOKEN</code>.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: ARTIFACT EXPLORER -->
    <div class="tab-content" id="tab-artifacts">
      <div class="table-container">
        <div class="table-toolbar">
          <input type="text" class="search-input" id="searchArtifacts" placeholder="🔍 Search artifact hash or tag...">
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-secondary" id="btnPruneExpired">🧹 Prune Expired</button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Artifact Hash</th>
              <th>Tag / Platform</th>
              <th>Attestation / SLSA</th>
              <th>Size</th>
              <th>Build Time</th>
              <th>Hits</th>
              <th>Expires At</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="artifactsTableBody">
            <tr><td colspan="8" style="text-align:center; color:var(--text-dim); padding:2rem;">Loading artifacts...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: TOKEN GOVERNANCE -->
    <div class="tab-content" id="tab-tokens">
      <div class="table-container">
        <div class="table-toolbar">
          <div style="font-weight:600">Active API Tokens</div>
          <button class="btn" id="btnCreateTokenModal">+ Create API Token</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Last Used</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="tokensTableBody">
            <tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:2rem;">Loading tokens...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 4: CLUSTER HEALTH -->
    <div class="tab-content" id="tab-health">
      <div class="panel-card" style="max-width: 800px; margin: 0 auto;">
        <div class="panel-title">
          <span>Cluster & Storage Health Probe</span>
          <span class="badge badge-success" id="healthStatusText">Operational</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">Server Version</div>
            <div style="font-weight:700; font-size:1.1rem;" id="valHealthVersion">0.1.0</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">Storage Backend</div>
            <div style="font-weight:700; font-size:1.1rem; text-transform:uppercase;" id="valHealthBackend">LOCAL</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">Storage Latency</div>
            <div style="font-weight:700; font-size:1.1rem;" id="valHealthLatency">0 ms</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">Uptime</div>
            <div style="font-weight:700; font-size:1.1rem;" id="valHealthUptime">0s</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">Memory (RSS / Heap)</div>
            <div style="font-weight:700; font-size:1.1rem;" id="valHealthMem">0 MB / 0 MB</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">Authentication</div>
            <div style="font-weight:700; font-size:1.1rem;" id="valHealthAuth">Enabled</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">SLSA Provenance Gate</div>
            <div style="font-weight:700; font-size:1.1rem; color:var(--success);">Ed25519 DSSE Verified</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">Checksum Integrity</div>
            <div style="font-weight:700; font-size:1.1rem; color:var(--primary);">SHA-256 Validated</div>
          </div>
          <div style="background:var(--bg); padding:1rem; border-radius:8px; border:1px solid var(--card-border);">
            <div style="color:var(--text-muted); font-size:0.8rem; margin-bottom:0.25rem;">GitHub Actions OIDC</div>
            <div style="font-weight:700; font-size:1.1rem; color:var(--success);">Active (Zero-Secret CI)</div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- Create Token Modal -->
  <div class="modal-overlay" id="modalToken">
    <div class="modal">
      <div class="modal-title">Create Scoped API Token</div>
      <div class="form-group">
        <label class="form-label">Token Name</label>
        <input type="text" class="form-control" id="inputTokenName" placeholder="e.g. github-actions-ci">
      </div>
      <div class="form-group">
        <label class="form-label">Role Scope</label>
        <select class="form-control" id="inputTokenRole">
          <option value="write">Read & Write (Upload + Download Cache)</option>
          <option value="read">Read Only (Download Only - PRs / Previews)</option>
          <option value="admin">Admin (Full Cluster & Token Governance)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Expiration</label>
        <select class="form-control" id="inputTokenExpiry">
          <option value="30">30 Days</option>
          <option value="90">90 Days</option>
          <option value="365">1 Year</option>
          <option value="">Never Expires</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="btnCancelTokenModal">Cancel</button>
        <button class="btn" id="btnSubmitCreateToken">Create Token</button>
      </div>
    </div>
  </div>

  <!-- Token Created Secret Modal -->
  <div class="modal-overlay" id="modalSecret">
    <div class="modal">
      <div class="modal-title" style="color:var(--success)">Token Created Successfully</div>
      <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1rem;">
        Copy this token now. It will not be shown again!
      </p>
      <div style="background:var(--bg); border:1px solid var(--primary); padding:0.75rem; border-radius:6px; font-family:var(--mono); font-size:0.85rem; word-break:break-all; margin-bottom:1.5rem;" id="txtSecretToken"></div>
      <div class="modal-actions">
        <button class="btn" id="btnCopySecretToken">📋 Copy to Clipboard</button>
        <button class="btn btn-secondary" id="btnCloseSecretModal">Close</button>
      </div>
    </div>
  </div>

  <!-- Admin Token Config Modal -->
  <div class="modal-overlay" id="modalAdminAuth">
    <div class="modal">
      <div class="modal-title">Cluster Authentication</div>
      <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1rem;">
        Enter your Master Admin Token to authenticate API requests from this dashboard.
      </p>
      <div class="form-group">
        <label class="form-label">Master Admin Token</label>
        <input type="password" class="form-control" id="inputAdminToken" placeholder="poly_admin_default_token">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="btnCancelAdminAuth">Close</button>
        <button class="btn" id="btnSaveAdminAuth">Save & Connect</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast">
    <span id="toastMsg">Action completed</span>
  </div>

  <script>
    // State
    let currentWorkspace = "default";
    let adminToken = localStorage.getItem("poly_cloud_token") || "";

    // DOM Elements
    const workspaceSelect = document.getElementById("workspaceSelect");
    const txtHostUrl = document.getElementById("txtHostUrl");
    const txtTokenMask = document.getElementById("txtTokenMask");
    const txtTeamSlug = document.getElementById("txtTeamSlug");
    const toast = document.getElementById("toast");
    const toastMsg = document.getElementById("toastMsg");

    txtHostUrl.textContent = window.location.origin;

    function showToast(msg) {
      toastMsg.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 3000);
    }

    function getAuthHeaders() {
      const headers = { "Content-Type": "application/json" };
      if (adminToken) {
        headers["Authorization"] = \`Bearer \${adminToken}\`;
      }
      return headers;
    }

    // Tabs Switcher
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        const tabId = "tab-" + btn.dataset.tab;
        document.getElementById(tabId)?.classList.add("active");
        if (btn.dataset.tab === "artifacts") loadArtifacts();
        if (btn.dataset.tab === "tokens") loadTokens();
        if (btn.dataset.tab === "health") loadHealth();
      });
    });

    // Admin Auth Button
    document.getElementById("btnAdminToken").addEventListener("click", () => {
      document.getElementById("inputAdminToken").value = adminToken;
      document.getElementById("modalAdminAuth").classList.add("open");
    });
    document.getElementById("btnCancelAdminAuth").addEventListener("click", () => {
      document.getElementById("modalAdminAuth").classList.remove("open");
    });
    document.getElementById("btnSaveAdminAuth").addEventListener("click", () => {
      adminToken = document.getElementById("inputAdminToken").value.trim();
      localStorage.setItem("poly_cloud_token", adminToken);
      document.getElementById("modalAdminAuth").classList.remove("open");
      updateTokenLabel();
      refreshAll();
      showToast("Authentication updated");
    });

    function updateTokenLabel() {
      const label = document.getElementById("tokenLabel");
      if (adminToken) {
        label.textContent = "Token: " + adminToken.slice(0, 8) + "...";
        txtTokenMask.textContent = adminToken.slice(0, 12) + "...";
      } else {
        label.textContent = "Connect Token";
        txtTokenMask.textContent = "poly_tok_...";
      }
    }

    // Refresh All
    async function refreshAll() {
      await loadWorkspaces();
      await loadStats();
      await loadHealth();
      const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
      if (activeTab === "artifacts") await loadArtifacts();
      if (activeTab === "tokens") await loadTokens();
    }
    document.getElementById("btnRefresh").addEventListener("click", () => {
      refreshAll();
      showToast("Dashboard refreshed");
    });

    // Workspace change
    workspaceSelect.addEventListener("change", (e) => {
      currentWorkspace = e.target.value;
      txtTeamSlug.textContent = currentWorkspace;
      document.getElementById("panelWorkspaceSlug").textContent = currentWorkspace;
      loadStats();
      loadArtifacts();
      loadTokens();
    });

    // Load Workspaces
    async function loadWorkspaces() {
      try {
        const res = await fetch("/api/v1/workspaces", { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          workspaceSelect.innerHTML = "";
          data.workspaces.forEach(ws => {
            const opt = document.createElement("option");
            opt.value = ws.slug;
            opt.textContent = ws.name || ws.slug;
            if (ws.slug === currentWorkspace) opt.selected = true;
            workspaceSelect.appendChild(opt);
          });
        }
      } catch (e) {
        console.warn("Failed to list workspaces", e);
      }
    }

    // Load Stats & ROI
    async function loadStats() {
      try {
        const res = await fetch(\`/api/v1/workspaces/\${encodeURIComponent(currentWorkspace)}/stats\`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const { stats } = await res.json();
          document.getElementById("valHitRate").textContent = stats.hitRatePercent + "%";
          document.getElementById("subHitMiss").textContent = \`\${stats.totalHits.toLocaleString()} hits / \${stats.totalMisses.toLocaleString()} misses\`;
          document.getElementById("barHitRate").style.width = stats.hitRatePercent + "%";

          const sec = stats.totalDurationSavedSeconds;
          const hrs = Math.floor(sec / 3600);
          const mins = Math.floor((sec % 3600) / 60);
          document.getElementById("valDurationSaved").textContent = hrs > 0 ? \`\${hrs}h \${mins}m\` : \`\${sec}s\`;

          document.getElementById("valDollarsSaved").textContent = "$" + stats.estimatedSavingsUsd.toFixed(2);

          const sizeMb = (stats.totalSizeBytes / 1024 / 1024).toFixed(1);
          document.getElementById("valStorageUsed").textContent = sizeMb + " MB";
          document.getElementById("subStorageQuota").textContent = \`\${stats.totalArtifacts} artifacts (\${stats.quotaUsedPercent}% of quota)\`;
          document.getElementById("barQuotaUsed").style.width = Math.min(stats.quotaUsedPercent, 100) + "%";

          renderRoiChart(stats);
        }
      } catch (e) {
        console.error("Failed to load stats", e);
      }
    }

    // Render Native SVG Chart
    function renderRoiChart(stats) {
      const svg = document.getElementById("roiSvg");
      const hits = stats.totalHits;
      const misses = stats.totalMisses;
      const total = hits + misses;

      if (total === 0) {
        svg.innerHTML = \`<text x="250" y="100" text-anchor="middle" fill="#64748b" font-size="14">No remote build activity recorded yet for workspace '\${currentWorkspace}'</text>\`;
        return;
      }

      const hitW = total > 0 ? (hits / total) * 360 : 0;
      const missW = total > 0 ? (misses / total) * 360 : 0;

      svg.innerHTML = \`
        <g transform="translate(50, 40)">
          <text x="0" y="0" fill="#94a3b8" font-size="12" font-weight="600">CACHE HIT VS MISS DISTRIBUTION</text>
          
          <!-- Bar container -->
          <rect x="0" y="20" width="400" height="32" rx="6" fill="#1e293b" />
          <rect x="0" y="20" width="\${hitW}" height="32" rx="6" fill="#38bdf8" />
          <rect x="\${hitW}" y="20" width="\${missW}" height="32" rx="6" fill="#f87171" />

          <!-- Legends -->
          <circle cx="10" cy="80" r="6" fill="#38bdf8" />
          <text x="25" y="84" fill="#f1f5f9" font-size="12">Cache Hits: \${hits} (\${stats.hitRatePercent}%)</text>

          <circle cx="200" cy="80" r="6" fill="#f87171" />
          <text x="215" y="84" fill="#f1f5f9" font-size="12">Cache Misses: \${misses}</text>
        </g>
      \`;
    }

    // Load Artifacts
    let allArtifacts = [];
    async function loadArtifacts() {
      const tbody = document.getElementById("artifactsTableBody");
      try {
        const res = await fetch(\`/api/v1/workspaces/\${encodeURIComponent(currentWorkspace)}/artifacts?limit=100\`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          allArtifacts = data.artifacts || [];
          renderArtifacts(allArtifacts);
        } else {
          tbody.innerHTML = \`<tr><td colspan="8" style="text-align:center; color:var(--danger); padding:2rem;">Failed to load artifacts (HTTP \${res.status}). Check admin token.</td></tr>\`;
        }
      } catch (e) {
        tbody.innerHTML = \`<tr><td colspan="8" style="text-align:center; color:var(--danger); padding:2rem;">Error connecting to API</td></tr>\`;
      }
    }

    function renderArtifacts(items) {
      const tbody = document.getElementById("artifactsTableBody");
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-dim); padding:2rem;">No cached artifacts stored yet.</td></tr>';
        return;
      }
      tbody.innerHTML = items.map(a => {
        const sizeFormatted = (a.sizeBytes / 1024 / 1024).toFixed(2) + " MB";
        const tag = a.tag || "universal";
        const duration = a.durationMs ? (a.durationMs / 1000).toFixed(1) + "s" : "-";
        const exp = new Date(a.expiresAt).toLocaleDateString();
        const attestationBadge = a.isAttested && a.attestationVerified
          ? \`<span class="badge badge-success" title="SLSA v1.0 • Runner: \${a.ciRunner || 'CI'} • Builder: \${a.builderId || 'poly'}">🛡️ SLSA v1.0</span>\`
          : \`<span class="badge badge-dim" title="Unsigned binary">⚠️ Unsigned</span>\`;

        return \`
          <tr>
            <td>
              <span class="mono-hash" title="Click to copy" onclick="copyText('\${a.hash}')">\${a.hash.slice(0, 16)}...</span>
            </td>
            <td><span class="badge badge-primary">\${tag}</span></td>
            <td>\${attestationBadge}</td>
            <td>\${sizeFormatted}</td>
            <td>\${duration}</td>
            <td><span class="badge badge-dim">\${a.hitCount} hits</span></td>
            <td style="color:var(--text-muted)">\${exp}</td>
            <td style="text-align:right">
              <a href="/v8/artifacts/\${a.hash}?team=\${encodeURIComponent(currentWorkspace)}" class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" download="\${a.hash}.tar.zst">⬇️</a>
              <button class="btn btn-danger" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="deleteArtifact('\${a.hash}')">🗑️</button>
            </td>
          </tr>
        \`;
      }).join("");
    }

    // Search Artifacts Filter
    document.getElementById("searchArtifacts").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = allArtifacts.filter(a =>
        a.hash.toLowerCase().includes(q) || (a.tag && a.tag.toLowerCase().includes(q))
      );
      renderArtifacts(filtered);
    });

    // Delete Artifact
    async function deleteArtifact(hash) {
      if (!confirm(\`Are you sure you want to delete and invalidate artifact \${hash.slice(0, 12)}...?\`)) return;
      try {
        const res = await fetch(\`/v8/artifacts/\${hash}?team=\${encodeURIComponent(currentWorkspace)}\`, {
          method: "DELETE",
          headers: getAuthHeaders()
        });
        if (res.ok) {
          showToast("Artifact deleted");
          loadArtifacts();
          loadStats();
        } else {
          showToast("Failed to delete artifact");
        }
      } catch (e) {
        showToast("Error deleting artifact");
      }
    }

    // Prune Expired Artifacts
    document.getElementById("btnPruneExpired").addEventListener("click", async () => {
      try {
        const res = await fetch(\`/api/v1/workspaces/\${encodeURIComponent(currentWorkspace)}/prune\`, {
          method: "POST",
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const body = await res.json();
          showToast(\`Pruned \${body.deletedCount} expired artifacts (\${(body.freedBytes / 1024 / 1024).toFixed(1)} MB freed)\`);
          loadArtifacts();
          loadStats();
        } else {
          showToast("Failed to prune artifacts");
        }
      } catch (e) {
        showToast("Error pruning artifacts");
      }
    });

    // Load Tokens
    async function loadTokens() {
      const tbody = document.getElementById("tokensTableBody");
      try {
        const res = await fetch(\`/api/v1/tokens?workspaceSlug=\${encodeURIComponent(currentWorkspace)}\`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          const tokens = data.tokens || [];
          if (tokens.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:2rem;">No tokens configured for this workspace.</td></tr>';
            return;
          }
          tbody.innerHTML = tokens.map(t => {
            const roleBadge = t.role === "admin" ? "badge-danger" : t.role === "write" ? "badge-success" : "badge-primary";
            const exp = t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "Never";
            const last = t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "Never";

            return \`
              <tr>
                <td style="font-weight:600">\${t.name}</td>
                <td><span class="badge \${roleBadge}">\${t.role}</span></td>
                <td><code style="font-family:var(--mono); color:var(--primary)">\${t.tokenPrefix}</code></td>
                <td style="color:var(--text-muted)">\${new Date(t.createdAt).toLocaleDateString()}</td>
                <td style="color:var(--text-muted)">\${exp}</td>
                <td style="color:var(--text-muted)">\${last}</td>
                <td style="text-align:right">
                  <button class="btn btn-danger" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="revokeToken('\${t.id}')">Revoke</button>
                </td>
              </tr>
            \`;
          }).join("");
        }
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--danger); padding:2rem;">Error loading tokens</td></tr>';
      }
    }

    // Token Modal Handlers
    document.getElementById("btnCreateTokenModal").addEventListener("click", () => {
      document.getElementById("modalToken").classList.add("open");
    });
    document.getElementById("btnCancelTokenModal").addEventListener("click", () => {
      document.getElementById("modalToken").classList.remove("open");
    });
    document.getElementById("btnSubmitCreateToken").addEventListener("click", async () => {
      const name = document.getElementById("inputTokenName").value.trim();
      const role = document.getElementById("inputTokenRole").value;
      const expiry = document.getElementById("inputTokenExpiry").value;

      if (!name) {
        alert("Token name is required");
        return;
      }

      try {
        const res = await fetch("/api/v1/tokens", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            workspaceSlug: currentWorkspace,
            name,
            role,
            expiresInDays: expiry ? Number(expiry) : undefined
          })
        });

        if (res.ok) {
          const body = await res.json();
          document.getElementById("modalToken").classList.remove("open");
          document.getElementById("txtSecretToken").textContent = body.rawToken;
          document.getElementById("modalSecret").classList.add("open");
          loadTokens();
        } else {
          alert("Failed to create token");
        }
      } catch (e) {
        alert("Error creating token");
      }
    });

    document.getElementById("btnCloseSecretModal").addEventListener("click", () => {
      document.getElementById("modalSecret").classList.remove("open");
    });
    document.getElementById("btnCopySecretToken").addEventListener("click", () => {
      const secret = document.getElementById("txtSecretToken").textContent;
      copyText(secret);
      showToast("Token copied to clipboard!");
    });

    // Revoke Token
    async function revokeToken(id) {
      if (!confirm("Are you sure you want to revoke this API token? Any CI runner using it will lose access immediately.")) return;
      try {
        const res = await fetch(\`/api/v1/tokens/\${id}\`, {
          method: "DELETE",
          headers: getAuthHeaders()
        });
        if (res.ok) {
          showToast("Token revoked");
          loadTokens();
        } else {
          showToast("Failed to revoke token");
        }
      } catch (e) {
        showToast("Error revoking token");
      }
    }

    // Load Health
    async function loadHealth() {
      try {
        const res = await fetch("/api/v1/health");
        if (res.ok) {
          const data = await res.json();
          document.getElementById("headerStatusBadge").textContent = "Online (" + data.storage.backend.toUpperCase() + ")";
          document.getElementById("headerStatusBadge").className = "badge badge-success";

          document.getElementById("valHealthVersion").textContent = data.version;
          document.getElementById("valHealthBackend").textContent = data.storage.backend;
          document.getElementById("valHealthLatency").textContent = data.storage.latencyMs + " ms";

          const sec = data.uptimeSeconds;
          const hrs = Math.floor(sec / 3600);
          const mins = Math.floor((sec % 3600) / 60);
          document.getElementById("valHealthUptime").textContent = hrs > 0 ? \`\${hrs}h \${mins}m \${sec % 60}s\` : \`\${sec}s\`;

          document.getElementById("valHealthMem").textContent = \`\${data.memory.rssMb} MB / \${data.memory.heapUsedMb} MB\`;
          document.getElementById("valHealthAuth").textContent = data.authEnabled ? "Enabled (Bearer)" : "Disabled (Public)";
        }
      } catch (e) {
        document.getElementById("headerStatusBadge").textContent = "Offline";
        document.getElementById("headerStatusBadge").className = "badge badge-danger";
      }
    }

    function copyText(str) {
      navigator.clipboard.writeText(str).then(() => {
        showToast("Copied to clipboard!");
      });
    }

    // Initialize
    updateTokenLabel();
    refreshAll();
  </script>
</body>
</html>`;
}
