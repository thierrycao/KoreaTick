const NAVER_BASE = 'https://m.stock.naver.com/front-api';

const NAME_ZH = {
  '005930': '三星电子',
  '000660': 'SK海力士',
  '402340': 'SK Square',
  '005935': '三星电子优先股',
  '005380': '现代汽车',
  '000270': '起亚',
  '035420': 'NAVER',
  '035720': 'Kakao',
  '051910': 'LG化学',
  '068270': 'Celltrion',
  KOSPI: 'KOSPI 韩国综合指数',
  KOSDAQ: 'KOSDAQ 韩国创业板',
  KPI200: 'KOSPI 200',
  KPI100: 'KOSPI 100'
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type'
    },
    body: JSON.stringify(body)
  };
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/%/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSymbol(input) {
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === '^KS11' || raw === 'KRX:KOSPI') return 'KOSPI';
  if (raw === 'KRX:KOSDAQ') return 'KOSDAQ';
  if (raw.startsWith('KRX:')) return raw.slice(4);
  if (/^\d{6}$/.test(raw)) return raw;
  if (/^KOSPI|KOSDAQ|KPI100|KPI200|FUT$/.test(raw)) return raw;
  return raw;
}

function endTypeFor(code) {
  return /^\d{6}$/.test(code) ? 'stock' : 'index';
}

function naverHeaders() {
  return {
    'user-agent': 'Mozilla/5.0 StockCN/1.0',
    'accept': 'application/json,text/plain,*/*',
    'referer': 'https://m.stock.naver.com/domestic/home/capitalization/total'
  };
}

async function naverGet(path, params = {}) {
  const url = new URL(`${NAVER_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url, { headers: naverHeaders() });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok || data?.isSuccess === false) {
    throw new Error(data?.message || `${path} ${response.status}`);
  }
  return data;
}

async function naverPost(path, body = {}, params = {}) {
  const url = new URL(`${NAVER_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...naverHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok || data?.isSuccess === false) {
    throw new Error(data?.message || `${path} ${response.status}`);
  }
  return data;
}

function mapRealtimeItem(item, fallbackCode) {
  const code = item?.itemCode || item?.id || fallbackCode;
  const price = toNumber(item?.currentPrice);
  const change = toNumber(item?.fluctuations);
  const changePercent = toNumber(item?.fluctuationsRatio);
  const previousClose = Number.isFinite(price) && Number.isFinite(change) ? price - change : null;
  const after = item?.overMarketPriceInfo || null;
  return {
    input: fallbackCode,
    symbol: `KRX:${code}`,
    code,
    name: NAME_ZH[code] || item?.name || code,
    originalName: item?.name || '',
    endType: item?.stockEndType || endTypeFor(code),
    exchange: item?.stockExchangeType || '',
    price,
    previousClose,
    change,
    changePercent,
    currency: item?.currencyType || 'KRW',
    volume: toNumber(item?.accumulatedTradingVolume),
    tradingValue: toNumber(item?.accumulatedTradingValue),
    marketCap: toNumber(item?.marketValue),
    marketStatus: item?.marketStatus || '',
    afterMarket: after ? {
      price: toNumber(after.overPrice),
      change: toNumber(after.fluctuations),
      changePercent: toNumber(after.fluctuationsRatio),
      status: after.overMarketStatus || '',
      session: after.tradingSessionType || ''
    } : null,
    marketTime: item?.localTradedAt || null,
    delayTime: item?.delayTime ?? 0,
    miniImageChartUrl: item?.miniImageChartUrl || null
  };
}

async function fetchRealtime(codes, endType) {
  if (!codes.length) return {};
  const data = await naverPost('/realTime/unified', {
    stockType: 'domestic',
    stockEndType: endType,
    codes,
    isNxt: false
  });
  return data?.result?.items || {};
}

function movingAverage(points, size) {
  return points.map((point, index) => {
    if (index + 1 < size) return null;
    const window = points.slice(index + 1 - size, index + 1).map(item => item.close);
    if (window.some(value => !Number.isFinite(value))) return null;
    return window.reduce((sum, value) => sum + value, 0) / size;
  });
}

async function fetchDailyPoints(code, pageSize = 50) {
  if (!/^\d{6}$/.test(code)) return [];
  const data = await naverGet('/stock/domestic/price/list', { code, page: 1, pageSize });
  const rows = Array.isArray(data?.result) ? data.result.slice().reverse() : [];
  const points = rows.map(row => ({
    time: row.localTradedAt,
    close: toNumber(row.closePrice),
    open: toNumber(row.openPrice),
    high: toNumber(row.highPrice),
    low: toNumber(row.lowPrice),
    volume: toNumber(row.accumulatedTradingVolume),
    change: toNumber(row.compareToPreviousClosePrice),
    changePercent: toNumber(row.fluctuationsRatio)
  })).filter(point => Number.isFinite(point.close));
  const ma5 = movingAverage(points, 5);
  const ma20 = movingAverage(points, 20);
  return points.map((point, index) => ({ ...point, ma5: ma5[index], ma20: ma20[index] }));
}

async function fetchBasic(code) {
  if (!/^\d{6}$/.test(code)) return null;
  try {
    const data = await naverGet('/stock/domestic/basic', { code, endType: 'stock' });
    return data?.result || null;
  } catch {
    return null;
  }
}

module.exports = {
  NAME_ZH,
  json,
  toNumber,
  normalizeSymbol,
  endTypeFor,
  naverGet,
  naverPost,
  mapRealtimeItem,
  fetchRealtime,
  fetchDailyPoints,
  fetchBasic
};
