const { toNumber } = require('./naver-client');

const MARKET_NAMES = {
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

const SOURCE_LABELS = {
  auto: '自动',
  ths: '同花顺',
  futu: '富途牛牛',
  eastmoney: '东方财富',
  tencent: '腾讯行情'
};

function normalizeMarketSymbol(input) {
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw.startsWith('HKEX:') || raw.startsWith('HK:')) {
    const code = raw.split(':')[1].replace(/\.HK$/, '').padStart(5, '0');
    return { market: 'HKEX', code, symbol: `HKEX:${code}`, ths: `hk_${code}`, eastmoney: `116.${code}`, tencent: `hk${code}` };
  }
  if (/^\d{4,5}\.HK$/.test(raw)) {
    const code = raw.replace('.HK', '').padStart(5, '0');
    return { market: 'HKEX', code, symbol: `HKEX:${code}`, ths: `hk_${code}`, eastmoney: `116.${code}`, tencent: `hk${code}` };
  }
  if (raw.startsWith('SZSE:') || raw.startsWith('SZ:')) {
    const code = raw.split(':')[1];
    return { market: 'SZSE', code, symbol: `SZSE:${code}`, ths: `hs_${code}`, eastmoney: `0.${code}`, tencent: `sz${code}` };
  }
  if (raw.startsWith('SSE:') || raw.startsWith('SH:')) {
    const code = raw.split(':')[1];
    return { market: 'SSE', code, symbol: `SSE:${code}`, ths: `hs_${code}`, eastmoney: `1.${code}`, tencent: `sh${code}` };
  }
  if (/^\d{6}\.(SZ|SH)$/.test(raw)) {
    const [code, suffix] = raw.split('.');
    const market = suffix === 'SZ' ? 'SZSE' : 'SSE';
    return { market, code, symbol: `${market}:${code}`, ths: `hs_${code}`, eastmoney: `${suffix === 'SZ' ? '0' : '1'}.${code}`, tencent: `${suffix.toLowerCase()}${code}` };
  }
  return null;
}

function isHK(meta) { return meta?.market === 'HKEX'; }
function isA(meta) { return meta?.market === 'SZSE' || meta?.market === 'SSE'; }
function scaleEM(meta, value) { return toNumber(value) == null ? null : toNumber(value) / (isHK(meta) ? 1000 : 100); }
function sourceInfo(id) { return { source: id, sourceName: SOURCE_LABELS[id] || id }; }

function addChangePercent(points) {
  return points.map((point, index) => {
    const previous = index > 0 ? points[index - 1].close : null;
    const change = Number.isFinite(point.close) && Number.isFinite(previous) ? point.close - previous : null;
    const changePercent = Number.isFinite(change) && previous ? change / previous * 100 : null;
    return { ...point, change, changePercent };
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

function withMA(points) {
  const withChange = addChangePercent(points);
  const ma5 = movingAverage(withChange, 5);
  const ma20 = movingAverage(withChange, 20);
  return withChange.map((point, index) => ({ ...point, ma5: ma5[index], ma20: ma20[index] }));
}

async function fetchText(url, encoding = 'utf-8', referer = 'https://finance.sina.com.cn/') {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 KoreaTick/1.0', referer } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const buffer = await response.arrayBuffer();
  return new TextDecoder(encoding).decode(buffer);
}

async function fetchTHSQuote(meta) {
  if (!isA(meta)) throw new Error('同花顺公开接口暂不支持该港股代码');
  const url = `https://d.10jqka.com.cn/v6/realhead/${meta.ths}/last.js`;
  const text = await fetchText(url, 'utf-8', `https://stockpage.10jqka.com.cn/${meta.code}/`);
  const match = text.match(/\((\{[\s\S]*\})\)\s*;?$/);
  if (!match) throw new Error('同花顺返回格式异常');
  const items = JSON.parse(match[1]).items || {};
  const price = toNumber(items['10']);
  const previousClose = toNumber(items['6']);
  return {
    input: meta.symbol,
    symbol: meta.symbol,
    code: meta.code,
    name: MARKET_NAMES[meta.symbol] || items.name || meta.symbol,
    originalName: items.name || '',
    endType: 'stock',
    exchange: meta.market === 'SZSE' ? '深交所' : '上交所',
    price,
    previousClose,
    change: toNumber(items['264648']) ?? (Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null),
    changePercent: toNumber(items['199112']),
    currency: 'CNY',
    open: toNumber(items['7']),
    high: toNumber(items['8']),
    low: toNumber(items['9']),
    volume: toNumber(items['13']),
    tradingValue: toNumber(items['19']),
    marketCap: toNumber(items['3541450']),
    marketStatus: items.stockStatus || '',
    marketTime: items.updateTime || items.time || '',
    delayTime: 0,
    miniImageChartUrl: null,
    points: [],
    ...sourceInfo('ths')
  };
}

async function fetchTHSDaily(meta) {
  if (!isA(meta)) return [];
  const url = `https://d.10jqka.com.cn/v6/line/${meta.ths}/01/last.js`;
  const text = await fetchText(url, 'utf-8', `https://stockpage.10jqka.com.cn/${meta.code}/`);
  const match = text.match(/\((\{[\s\S]*\})\)\s*;?$/);
  if (!match) return [];
  const data = JSON.parse(match[1]);
  const rows = String(data.data || '').split(';').filter(Boolean).slice(-50);
  const points = rows.map(row => {
    const parts = row.split(',');
    return {
      time: `${parts[0].slice(0, 4)}-${parts[0].slice(4, 6)}-${parts[0].slice(6, 8)}`,
      open: toNumber(parts[1]),
      close: toNumber(parts[2]),
      high: toNumber(parts[3]),
      low: toNumber(parts[4]),
      volume: toNumber(parts[5])
    };
  }).filter(point => Number.isFinite(point.close));
  return withMA(points);
}

async function fetchFutuQuote() {
  throw new Error('富途牛牛网页接口暂未提供稳定免登录行情 API');
}
async function fetchFutuDaily() { return []; }

async function fetchEastmoneyQuote(meta) {
  const fields = 'f43,f44,f45,f46,f47,f48,f49,f57,f58,f60,f116,f169,f170,f171,f168';
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${meta.eastmoney}&fields=${fields}`;
  const data = JSON.parse(await fetchText(url, 'utf-8', 'https://quote.eastmoney.com/'));
  const d = data.data;
  if (!d) throw new Error('东方财富未返回行情');
  const price = scaleEM(meta, d.f43);
  const previousClose = scaleEM(meta, d.f60);
  return {
    input: meta.symbol,
    symbol: meta.symbol,
    code: meta.code,
    name: MARKET_NAMES[meta.symbol] || d.f58 || meta.symbol,
    originalName: d.f58 || '',
    endType: 'stock',
    exchange: isHK(meta) ? '港交所' : (meta.market === 'SZSE' ? '深交所' : '上交所'),
    price,
    previousClose,
    change: scaleEM(meta, d.f169),
    changePercent: toNumber(d.f170) == null ? null : toNumber(d.f170) / 100,
    currency: isHK(meta) ? 'HKD' : 'CNY',
    open: scaleEM(meta, d.f46),
    high: scaleEM(meta, d.f44),
    low: scaleEM(meta, d.f45),
    volume: isHK(meta) ? toNumber(d.f47) : toNumber(d.f47) * 100,
    tradingValue: toNumber(d.f48),
    marketCap: toNumber(d.f116),
    marketStatus: '',
    marketTime: '',
    delayTime: 0,
    miniImageChartUrl: null,
    points: [],
    ...sourceInfo('eastmoney')
  };
}

async function fetchEastmoneyDaily(meta) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${meta.eastmoney}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&end=20500101&lmt=50`;
  const data = JSON.parse(await fetchText(url, 'utf-8', 'https://quote.eastmoney.com/'));
  const rows = data.data?.klines || [];
  const points = rows.map(row => {
    const p = row.split(',');
    return { time: p[0], open: toNumber(p[1]), close: toNumber(p[2]), high: toNumber(p[3]), low: toNumber(p[4]), volume: isA(meta) ? toNumber(p[5]) * 100 : toNumber(p[5]) };
  }).filter(point => Number.isFinite(point.close));
  return withMA(points);
}

async function fetchTencentText(metas) {
  const url = `https://qt.gtimg.cn/q=${metas.map(meta => meta.tencent).join(',')}`;
  return fetchText(url, 'gbk', 'https://gu.qq.com/');
}

function parseTencentVars(text) {
  const map = new Map();
  const regex = /v_([a-z]{2}\d{5,6})="([^"]*)";/g;
  let match;
  while ((match = regex.exec(text))) map.set(match[1], match[2].split('~'));
  return map;
}

function mapTencentQuote(meta, fields) {
  return {
    input: meta.symbol,
    symbol: meta.symbol,
    code: meta.code,
    name: MARKET_NAMES[meta.symbol] || fields[1] || meta.symbol,
    originalName: fields[1] || '',
    endType: 'stock',
    exchange: isHK(meta) ? '港交所' : (meta.market === 'SZSE' ? '深交所' : '上交所'),
    price: toNumber(fields[3]),
    previousClose: toNumber(fields[4]),
    change: toNumber(fields[31]),
    changePercent: toNumber(fields[32]),
    currency: isHK(meta) ? (fields[74] || 'HKD') : 'CNY',
    open: toNumber(fields[5]),
    high: toNumber(fields[33]),
    low: toNumber(fields[34]),
    volume: isHK(meta) ? toNumber(fields[36] || fields[6]) : toNumber(fields[36]) * 100,
    tradingValue: isHK(meta) ? toNumber(fields[37]) : toNumber(fields[37]) * 10000,
    marketCap: toNumber(fields[44]) ? toNumber(fields[44]) * 100000000 : null,
    marketStatus: '',
    marketTime: fields[30] || '',
    delayTime: 0,
    miniImageChartUrl: null,
    points: [],
    ...sourceInfo('tencent')
  };
}

async function fetchTencentQuotes(metas) {
  if (!metas.length) return [];
  const text = await fetchTencentText(metas);
  const rows = parseTencentVars(text);
  return metas.map(meta => {
    const fields = rows.get(meta.tencent);
    return fields ? mapTencentQuote(meta, fields) : null;
  }).filter(Boolean);
}

async function fetchTencentDaily(meta) {
  const path = isHK(meta) ? 'hkfqkline' : 'fqkline';
  const rowKey = isHK(meta) ? 'day' : 'qfqday';
  const url = `https://web.ifzq.gtimg.cn/appstock/app/${path}/get?param=${meta.tencent},day,,,50,qfq`;
  const data = JSON.parse(await fetchText(url, 'utf-8', 'https://gu.qq.com/'));
  const rows = data.data?.[meta.tencent]?.[rowKey] || data.data?.[meta.tencent]?.day || [];
  const points = rows.map(row => ({ time: row[0], open: toNumber(row[1]), close: toNumber(row[2]), high: toNumber(row[3]), low: toNumber(row[4]), volume: isA(meta) ? toNumber(row[5]) * 100 : toNumber(row[5]) })).filter(point => Number.isFinite(point.close));
  return withMA(points);
}

function providerOrder(requested, meta) {
  const normalized = ['ths', 'futu', 'eastmoney', 'tencent'].includes(requested) ? requested : 'ths';
  if (normalized === 'ths') return isA(meta) ? ['ths', 'futu', 'eastmoney', 'tencent'] : ['ths', 'futu', 'eastmoney', 'tencent'];
  if (normalized === 'futu') return ['futu', 'eastmoney', 'tencent'];
  if (normalized === 'eastmoney') return ['eastmoney', 'tencent'];
  if (normalized === 'tencent') return ['tencent', 'eastmoney'];
  return ['ths', 'futu', 'eastmoney', 'tencent'];
}

async function quoteByProvider(provider, meta) {
  if (provider === 'ths') return fetchTHSQuote(meta);
  if (provider === 'futu') return fetchFutuQuote(meta);
  if (provider === 'eastmoney') return fetchEastmoneyQuote(meta);
  if (provider === 'tencent') return (await fetchTencentQuotes([meta]))[0];
  throw new Error(`未知数据源 ${provider}`);
}

async function dailyByProvider(provider, meta) {
  if (provider === 'ths') return fetchTHSDaily(meta);
  if (provider === 'futu') return fetchFutuDaily(meta);
  if (provider === 'eastmoney') return fetchEastmoneyDaily(meta);
  if (provider === 'tencent') return fetchTencentDaily(meta);
  return [];
}

async function fetchOneMarketQuote(meta, includeHistory = false, requestedSource = 'ths') {
  const failures = [];
  for (const provider of providerOrder(requestedSource, meta)) {
    try {
      const quote = await quoteByProvider(provider, meta);
      if (!quote || !Number.isFinite(quote.price)) throw new Error('无价格');
      if (includeHistory) {
        try {
          quote.points = await dailyByProvider(quote.source, meta);
        } catch (error) {
          failures.push(`${quote.sourceName}日线: ${error.message}`);
          quote.points = [];
        }
        if (!quote.points.length && quote.source !== 'tencent') {
          try {
            quote.points = await fetchTencentDaily(meta);
            if (quote.points.length) failures.push('日线已回退腾讯行情');
          } catch (error) {
            failures.push(`腾讯日线: ${error.message}`);
          }
        }
      }
      if (failures.length) quote.sourceFallbacks = failures;
      return quote;
    } catch (error) {
      failures.push(`${SOURCE_LABELS[provider] || provider}: ${error.message}`);
    }
  }
  throw new Error(failures.join('；') || '所有数据源失败');
}

async function fetchMarketQuotes(metas, includeHistory = false, requestedSource = 'ths') {
  const settled = await Promise.allSettled(metas.map(meta => fetchOneMarketQuote(meta, includeHistory, requestedSource)));
  const quotes = [];
  const errors = [];
  settled.forEach((item, index) => {
    if (item.status === 'fulfilled') quotes.push(item.value);
    else errors.push({ symbol: metas[index].symbol, message: item.reason?.message || '行情源失败' });
  });
  return { quotes, errors };
}

module.exports = { MARKET_NAMES, SOURCE_LABELS, normalizeMarketSymbol, fetchMarketQuotes };
