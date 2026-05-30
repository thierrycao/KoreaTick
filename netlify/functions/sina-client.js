const { toNumber } = require('./naver-client');

const SINA_NAMES = {
  'HKEX:07709': 'XL2倍海力士',
  'HKEX:07747': 'XL三星电子',
  'HKEX:00992': '联想集团',
  'SZSE:002463': '沪电股份',
  'SZSE:300394': '天孚通信',
  'SSE:600396': '华电辽能',
  'SSE:600726': '华电能源',
  'SSE:601991': '大唐发电',
  'SSE:603986': '兆易创新',
  'SSE:688008': '澜起科技'
};

function normalizeMarketSymbol(input) {
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw.startsWith('HKEX:') || raw.startsWith('HK:')) {
    const code = raw.split(':')[1].replace(/\.HK$/, '').padStart(5, '0');
    return { market: 'HKEX', code, symbol: `HKEX:${code}`, sina: `hk${code}` };
  }
  if (/^\d{4,5}\.HK$/.test(raw)) {
    const code = raw.replace('.HK', '').padStart(5, '0');
    return { market: 'HKEX', code, symbol: `HKEX:${code}`, sina: `hk${code}` };
  }
  if (raw.startsWith('SZSE:') || raw.startsWith('SZ:')) {
    const code = raw.split(':')[1];
    return { market: 'SZSE', code, symbol: `SZSE:${code}`, sina: `sz${code}` };
  }
  if (raw.startsWith('SSE:') || raw.startsWith('SH:')) {
    const code = raw.split(':')[1];
    return { market: 'SSE', code, symbol: `SSE:${code}`, sina: `sh${code}` };
  }
  if (/^\d{6}\.(SZ|SH)$/.test(raw)) {
    const [code, suffix] = raw.split('.');
    const market = suffix === 'SZ' ? 'SZSE' : 'SSE';
    return { market, code, symbol: `${market}:${code}`, sina: `${suffix.toLowerCase()}${code}` };
  }
  return null;
}

async function fetchSinaText(list) {
  if (!list.length) return '';
  const url = `https://hq.sinajs.cn/list=${list.join(',')}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 KoreaTick/1.0',
      'referer': 'https://finance.sina.com.cn/'
    }
  });
  if (!response.ok) throw new Error(`Sina ${response.status}`);
  const buffer = await response.arrayBuffer();
  return new TextDecoder('gbk').decode(buffer);
}

function parseSinaVars(text) {
  const map = new Map();
  const regex = /var hq_str_([a-z0-9]+)="([^"]*)";/gi;
  let match;
  while ((match = regex.exec(text))) map.set(match[1].toLowerCase(), match[2].split(','));
  return map;
}

function mapAQuote(meta, fields) {
  const symbol = meta.symbol;
  const price = toNumber(fields[3]);
  const previousClose = toNumber(fields[2]);
  const change = Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null;
  const changePercent = Number.isFinite(change) && previousClose ? change / previousClose * 100 : null;
  return {
    input: symbol,
    symbol,
    code: meta.code,
    name: SINA_NAMES[symbol] || fields[0] || symbol,
    originalName: fields[0] || '',
    endType: 'stock',
    exchange: meta.market === 'SZSE' ? '深交所' : '上交所',
    price,
    previousClose,
    change,
    changePercent,
    currency: 'CNY',
    open: toNumber(fields[1]),
    high: toNumber(fields[4]),
    low: toNumber(fields[5]),
    volume: toNumber(fields[8]),
    tradingValue: toNumber(fields[9]),
    marketCap: null,
    marketStatus: fields[31] || '',
    marketTime: `${fields[30] || ''} ${fields[31] || ''}`.trim(),
    delayTime: 0,
    miniImageChartUrl: null,
    points: []
  };
}

function mapHKQuote(meta, fields) {
  const symbol = meta.symbol;
  const price = toNumber(fields[6]);
  const previousClose = toNumber(fields[3]);
  const change = toNumber(fields[7]);
  const changePercent = toNumber(fields[8]);
  return {
    input: symbol,
    symbol,
    code: meta.code,
    name: SINA_NAMES[symbol] || fields[1] || fields[0] || symbol,
    originalName: fields[1] || fields[0] || '',
    endType: 'stock',
    exchange: '港交所',
    price,
    previousClose,
    change: Number.isFinite(change) ? change : (Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null),
    changePercent,
    currency: 'HKD',
    open: toNumber(fields[2]),
    high: toNumber(fields[4]),
    low: toNumber(fields[5]),
    volume: toNumber(fields[11]),
    tradingValue: toNumber(fields[10]),
    marketCap: null,
    marketStatus: fields[18] || '',
    marketTime: `${fields[17] || ''} ${fields[18] || ''}`.trim(),
    delayTime: 0,
    miniImageChartUrl: null,
    points: []
  };
}

function addChangePercent(points) {
  return points.map((point, index) => {
    const previous = index > 0 ? points[index - 1].close : null;
    const dailyChange = Number.isFinite(point.close) && Number.isFinite(previous) ? point.close - previous : null;
    const dailyChangePercent = Number.isFinite(dailyChange) && previous ? dailyChange / previous * 100 : null;
    return { ...point, change: dailyChange, changePercent: dailyChangePercent };
  });
}

function movingAverage(points, size) {
  return points.map((_, index) => {
    if (index + 1 < size) return null;
    const window = points.slice(index + 1 - size, index + 1).map(item => item.close);
    if (window.some(value => !Number.isFinite(value))) return null;
    return window.reduce((total, value) => total + value, 0) / size;
  });
}

async function fetchSinaDaily(meta, datalen = 50) {
  if (!['SZSE', 'SSE'].includes(meta.market)) return [];
  const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${meta.sina}&scale=240&ma=no&datalen=${datalen}`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', 'referer': 'https://finance.sina.com.cn/' } });
  if (!response.ok) return [];
  const text = await response.text();
  const match = text.match(/var\s+_data=\((\[[\s\S]*\])\);?/);
  if (!match) return [];
  let rows;
  try { rows = JSON.parse(match[1]); } catch { return []; }
  const points = rows.map(row => ({
    time: row.day,
    close: toNumber(row.close),
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    volume: toNumber(row.volume)
  })).filter(point => Number.isFinite(point.close));
  const withChange = addChangePercent(points);
  const ma5 = movingAverage(withChange, 5);
  const ma20 = movingAverage(withChange, 20);
  return withChange.map((point, index) => ({ ...point, ma5: ma5[index], ma20: ma20[index] }));
}


async function fetchTencentHKText(metas) {
  if (!metas.length) return '';
  const url = `https://qt.gtimg.cn/q=${metas.map(meta => `hk${meta.code}`).join(',')}`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 KoreaTick/1.0', 'referer': 'https://gu.qq.com/' }
  });
  if (!response.ok) throw new Error(`Tencent HK ${response.status}`);
  const buffer = await response.arrayBuffer();
  return new TextDecoder('gbk').decode(buffer);
}

function parseTencentHKVars(text) {
  const map = new Map();
  const regex = /v_hk(\d{5})="([^"]*)";/g;
  let match;
  while ((match = regex.exec(text))) map.set(match[1], match[2].split('~'));
  return map;
}

function mapTencentHKQuote(meta, fields) {
  const symbol = meta.symbol;
  return {
    input: symbol,
    symbol,
    code: meta.code,
    name: SINA_NAMES[symbol] || fields[1] || symbol,
    originalName: fields[1] || '',
    endType: 'stock',
    exchange: '港交所',
    price: toNumber(fields[3]),
    previousClose: toNumber(fields[4]),
    change: toNumber(fields[31]),
    changePercent: toNumber(fields[32]),
    currency: fields[74] || 'HKD',
    open: toNumber(fields[5]),
    high: toNumber(fields[33]),
    low: toNumber(fields[34]),
    volume: toNumber(fields[36] || fields[6]),
    tradingValue: toNumber(fields[37]),
    marketCap: toNumber(fields[44]),
    marketStatus: fields[30] || '',
    marketTime: fields[30] || '',
    delayTime: 0,
    miniImageChartUrl: null,
    points: []
  };
}

async function fetchTencentHKDaily(meta) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk${meta.code},day,,,50,qfq`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', 'referer': 'https://gu.qq.com/' } });
  if (!response.ok) return [];
  let data;
  try { data = await response.json(); } catch { return []; }
  const rows = data?.data?.[`hk${meta.code}`]?.day || [];
  const points = rows.map(row => ({
    time: row[0],
    open: toNumber(row[1]),
    close: toNumber(row[2]),
    high: toNumber(row[3]),
    low: toNumber(row[4]),
    volume: toNumber(row[5])
  })).filter(point => Number.isFinite(point.close));
  const withChange = addChangePercent(points);
  const ma5 = movingAverage(withChange, 5);
  const ma20 = movingAverage(withChange, 20);
  return withChange.map((point, index) => ({ ...point, ma5: ma5[index], ma20: ma20[index] }));
}

async function fetchTencentHKQuotes(metas, includeHistory = false) {
  if (!metas.length) return [];
  const text = await fetchTencentHKText(metas);
  const rows = parseTencentHKVars(text);
  const quotes = [];
  for (const meta of metas) {
    const fields = rows.get(meta.code);
    if (!fields || !fields.length) continue;
    const quote = mapTencentHKQuote(meta, fields);
    if (includeHistory) quote.points = await fetchTencentHKDaily(meta);
    quotes.push(quote);
  }
  return quotes;
}

async function fetchSinaQuotes(metas, includeHistory = false) {
  if (!metas.length) return [];
  const hkMetas = metas.filter(meta => meta.market === 'HKEX');
  const mainlandMetas = metas.filter(meta => meta.market !== 'HKEX');
  const quotes = [];

  if (hkMetas.length) quotes.push(...await fetchTencentHKQuotes(hkMetas, includeHistory));

  if (mainlandMetas.length) {
    const text = await fetchSinaText(mainlandMetas.map(meta => meta.sina));
    const rows = parseSinaVars(text);
    for (const meta of mainlandMetas) {
      const fields = rows.get(meta.sina.toLowerCase());
      if (!fields || !fields.length || fields.every(field => !field)) continue;
      const quote = mapAQuote(meta, fields);
      if (includeHistory) quote.points = await fetchSinaDaily(meta);
      quotes.push(quote);
    }
  }

  return quotes;
}

module.exports = { SINA_NAMES, normalizeMarketSymbol, fetchSinaQuotes, fetchSinaDaily };
