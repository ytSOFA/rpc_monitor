'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { JsonRpcProvider } = require('ethers');
const dotenv = require('dotenv');

dotenv.config();

const CRON_EXPRESSION = process.env.CRON_EXPRESSION || '*/10 * * * *';
const MAX_ENTRIES = Number.parseInt(process.env.MAX_ENTRIES || '1008', 10);
const RPC_LIST_JSON = process.env.RPC_LIST_JSON || '';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LARK_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL || '';
const DATA_FILE = path.join(__dirname, 'rpc_status.json');
const REQUEST_TIMEOUT_MS = 10_000;

function parseRpcList() {
  if (!RPC_LIST_JSON) {
    console.error('RPC_LIST_JSON is required.');
    return null;
  }
  try {
    const parsed = JSON.parse(RPC_LIST_JSON);
    if (!parsed || typeof parsed !== 'object') {
      console.error('RPC_LIST_JSON must be a JSON object.');
      return null;
    }
    const normalized = {};
    for (const [chain, nodes] of Object.entries(parsed)) {
      if (!Array.isArray(nodes)) {
        continue;
      }
      const cleaned = nodes.filter((node) => node && typeof node.name === 'string' && typeof node.rpc === 'string');
      if (cleaned.length > 0) {
        normalized[chain] = cleaned;
      }
    }
    if (Object.keys(normalized).length === 0) {
      console.error('RPC_LIST_JSON does not include any valid nodes.');
      return null;
    }
    return normalized;
  } catch (err) {
    console.error('Failed to parse RPC_LIST_JSON:', err.message || err);
    return null;
  }
}

const rpcList = parseRpcList();
if (!rpcList) {
  process.exit(1);
}

let statusData = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    statusData = JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to load rpc_status.json, starting fresh:', err.message || err);
    statusData = {};
  }
}

function getNodeArray(chain, name) {
  if (!statusData[chain] || typeof statusData[chain] !== 'object') {
    statusData[chain] = {};
  }
  if (!Array.isArray(statusData[chain][name])) {
    statusData[chain][name] = [];
  }
  return statusData[chain][name];
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('timeout');
      error.code = 'TIMEOUT';
      reject(error);
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(err) {
  const message = (err && err.message) ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim();
}

function isNumberStatus(status) {
  return typeof status === 'number' && Number.isFinite(status);
}

async function sendLarkAlert(chain, node, status) {
  if (!LARK_WEBHOOK_URL) {
    return;
  }
  if (typeof fetch !== 'function') {
    console.warn('fetch is not available; cannot send Lark alert.');
    return;
  }
  const payload = {
    msg_type: 'text',
    content: {
      text: `${chain} ${node.name}\n${node.rpc}\n${status}`,
    },
  };
  try {
    const res = await fetch(LARK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`Lark alert failed (${res.status}): ${body}`);
    }
  } catch (err) {
    console.warn('Lark alert failed:', err.message || err);
  }
}

const providerCache = new Map();
function getProvider(rpcUrl) {
  if (!providerCache.has(rpcUrl)) {
    providerCache.set(rpcUrl, new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true }));
  }
  return providerCache.get(rpcUrl);
}

let isRunning = false;
async function checkRpcStatus() {
  if (isRunning) {
    console.warn('Previous check is still running, skipping this cycle.');
    return;
  }
  isRunning = true;
  const ts = Math.floor(Date.now() / 1000);

  try {
    for (const [chain, nodes] of Object.entries(rpcList)) {
      for (const node of nodes) {
        let status = 'timeout';
        try {
          const provider = getProvider(node.rpc);
          console.log(`Checking ${chain} - ${node.name} (${node.rpc})`);
          const blockNumber = await withTimeout(provider.getBlockNumber(), REQUEST_TIMEOUT_MS);
          status = blockNumber;
          console.log(`  ${chain} - ${node.name}: ${blockNumber}`);
        } catch (err) {
          if (err && err.code === 'TIMEOUT') {
            status = 'timeout';
          } else {
            status = formatError(err).slice(0, 100);
          }
        }

        const list = getNodeArray(chain, node.name);
        const prev = list.length > 0 ? list[list.length - 1] : null;
        const prev2 = list.length > 1 ? list[list.length - 2] : null;
        const currentError = !isNumberStatus(status);
        const prevError = prev ? !isNumberStatus(prev.status) : false;
        const prev2Error = prev2 ? !isNumberStatus(prev2.status) : false;
        if (currentError && prevError && !prev2Error) {
          await sendLarkAlert(chain, node, status);
        }
        list.push({ ts, status });
        if (list.length > MAX_ENTRIES) {
          statusData[chain][node.name] = list.slice(-MAX_ENTRIES);
        }

        await sleep(1000);
      }
    }
    console.log('RPC check completed, saving results...');
    await fs.promises.writeFile(DATA_FILE, JSON.stringify(statusData, null, 2));
  } catch (err) {
    console.warn('Failed to complete RPC check:', err.message || err);
  } finally {
    isRunning = false;
  }
}

function parseIntervalMinutes(expression) {
  const match = /^\s*\*\/(\d+)\s+\*\s+\*\s+\*\s+\*\s*$/.exec(expression);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

const app = express();
app.use(cors());

app.get('/api/rpc/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/rpc/status', (req, res) => {
  const rawCount = Number.parseInt(req.query.count, 10);
  const limit = Number.isFinite(rawCount) && rawCount > 0 && rawCount <= MAX_ENTRIES
    ? rawCount
    : null;

  const response = {};
  for (const [chain, nodes] of Object.entries(rpcList)) {
    response[chain] = {};
    for (const node of nodes) {
      const list = getNodeArray(chain, node.name);
      response[chain][node.name] = limit ? list.slice(-limit) : list;
    }
  }

  res.json(response);
});

app.get('/api/rpc/interval', (req, res) => {
  const minutes = parseIntervalMinutes(CRON_EXPRESSION);
  res.json({ minutes });
});

app.listen(PORT, HOST, () => {
  console.log(`RPC monitor backend listening on ${HOST}:${PORT}`);
  checkRpcStatus();
});

cron.schedule(CRON_EXPRESSION, () => {
  checkRpcStatus().catch((err) => {
    console.error('Scheduled check failed:', err.message || err);
  });
});
