const MAX_POINTS = 144;

const elements = {
  refreshInterval: document.getElementById('refresh-interval'),
  lastUpdate: document.getElementById('last-update'),
  charts: document.getElementById('charts'),
  refreshNow: document.getElementById('refresh-now')
};

const state = {
  apiBase: resolveApiBase(),
  intervalMinutes: null,
  timerId: null,
  lastData: null,
  lastRefreshAt: null,
  nextRefreshAt: null,
  isRefreshing: false
};

elements.refreshNow.addEventListener('click', () => {
  refreshOnce({ force: true });
});

void init();

async function init() {
  await loadInterval();
  await refreshOnce();
  scheduleRefresh();
}

function resolveApiBase() {
  const params = new URLSearchParams(window.location.search);
  const queryBase = params.get('api');
  const storedBase = window.localStorage.getItem('rpc-monitor-api');
  const origin = window.location.origin && window.location.origin !== 'null'
    ? window.location.origin
    : 'http://localhost:3000';

  const apiBase = (queryBase || storedBase || origin).replace(/\/$/, '');
  if (queryBase) {
    window.localStorage.setItem('rpc-monitor-api', apiBase);
  }
  return apiBase;
}

async function loadInterval() {
  try {
    const response = await fetch(`${state.apiBase}/api/rpc/interval`);
    if (!response.ok) {
      throw new Error(`Interval request failed (${response.status})`);
    }
    const data = await response.json();
    const minutes = Number.isFinite(data.minutes) && data.minutes > 0 ? data.minutes : null;
    state.intervalMinutes = minutes;
  } catch (error) {
    state.intervalMinutes = null;
  }

  if (state.intervalMinutes) {
    elements.refreshInterval.textContent = `${state.intervalMinutes} min`;
  } else {
    elements.refreshInterval.textContent = 'manual';
  }
}

async function refreshOnce(options = {}) {
  if (state.isRefreshing) {
    return;
  }
  if (!shouldRefreshNow(options)) {
    return;
  }
  state.isRefreshing = true;
  elements.refreshNow.disabled = true;

  try {
    const response = await fetch(`${state.apiBase}/api/rpc/status?count=${MAX_POINTS}`);
    if (!response.ok) {
      throw new Error(`Status request failed (${response.status})`);
    }
    const data = await response.json();
    state.lastData = data;
    render(data);
    const latest = getLatestTimestamp(data);
    elements.lastUpdate.textContent = latest ? formatTimestamp(latest) : '-';
  } catch (error) {
    console.error('Status error:', formatError(error));
  } finally {
    state.lastRefreshAt = Date.now();
    state.nextRefreshAt = getNextRefreshAt(state.lastRefreshAt);
    elements.refreshNow.disabled = false;
    state.isRefreshing = false;
  }
}

function scheduleRefresh() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
  }
  if (!state.intervalMinutes) {
    return;
  }
  state.timerId = window.setInterval(() => {
    refreshOnce();
  }, state.intervalMinutes * 60 * 1000);
}

function getNextRefreshAt(lastRefreshAt) {
  if (!state.intervalMinutes || !lastRefreshAt) {
    return null;
  }
  return lastRefreshAt + state.intervalMinutes * 60 * 1000;
}

function shouldRefreshNow(options = {}) {
  const { force = false } = options;
  if (force) {
    return true;
  }
  if (!state.intervalMinutes || !state.nextRefreshAt) {
    return true;
  }
  return Date.now() >= state.nextRefreshAt;
}

function handleResume() {
  if (!state.intervalMinutes) {
    return;
  }
  if (!state.nextRefreshAt || Date.now() >= state.nextRefreshAt) {
    refreshOnce();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    handleResume();
  }
});

window.addEventListener('focus', () => {
  handleResume();
});

function render(data) {
  elements.charts.innerHTML = '';

  const chains = Object.entries(data || {});
  if (chains.length === 0) {
    elements.charts.innerHTML = '<div class="chain-card">No data.</div>';
    return;
  }

  chains.forEach(([chainName, nodes]) => {
    const card = document.createElement('section');
    card.className = 'chain-card';

    const header = document.createElement('div');
    header.className = 'chain-header';

    const title = document.createElement('h2');
    title.className = 'chain-title';
    title.textContent = chainName;

    const meta = document.createElement('div');
    meta.className = 'chain-meta';
    meta.textContent = `${Object.keys(nodes || {}).length} nodes`;

    header.appendChild(title);
    header.appendChild(meta);
    card.appendChild(header);

    Object.entries(nodes || {}).forEach(([nodeName, samples]) => {
      const row = document.createElement('div');
      row.className = 'node-row';

      const label = document.createElement('div');
      label.className = 'node-name';
      label.textContent = nodeName;

      const barTrack = document.createElement('div');
      barTrack.className = 'bar-track';
      barTrack.style.setProperty('--points', MAX_POINTS);

      const padded = buildBars(samples);
      padded.forEach((entry) => {
        const bar = document.createElement('div');
        bar.className = 'bar';

        if (!entry) {
          bar.classList.add('empty');
          bar.title = 'No data';
        } else if (typeof entry.status === 'number') {
          bar.classList.add('ok');
          bar.title = `${formatTimestamp(entry.ts)}\nBlock ${entry.status}`;
        } else {
          bar.classList.add('bad');
          bar.title = `${formatTimestamp(entry.ts)}\n${String(entry.status)}`;
        }

        barTrack.appendChild(bar);
      });

      row.appendChild(label);
      row.appendChild(barTrack);
      card.appendChild(row);
    });

    elements.charts.appendChild(card);
  });
}

function buildBars(samples) {
  const list = Array.isArray(samples) ? samples.slice(-MAX_POINTS) : [];
  const reversed = list.slice().reverse();
  const padded = reversed.concat(new Array(Math.max(0, MAX_POINTS - reversed.length)).fill(null));
  return padded;
}

function getLatestTimestamp(data) {
  let latest = null;
  Object.values(data || {}).forEach((nodes) => {
    Object.values(nodes || {}).forEach((samples) => {
      if (!Array.isArray(samples) || samples.length === 0) {
        return;
      }
      const last = samples[samples.length - 1];
      if (last && typeof last.ts === 'number') {
        if (!latest || last.ts > latest) {
          latest = last.ts;
        }
      }
    });
  });
  return latest;
}

function formatTimestamp(ts) {
  if (!ts) {
    return '-';
  }
  return new Date(ts * 1000).toLocaleString();
}

function formatError(error) {
  if (!error) {
    return 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message || String(error);
}
