const {
  json,
  normalizeSymbol: normalizeKoreaSymbol,
  endTypeFor,
  fetchRealtime,
  mapRealtimeItem,
  fetchDailyPoints,
  fetchBasic
} = require('./naver-client');
const { normalizeMarketSymbol, fetchSinaQuotes } = require('./sina-client');

function normalizeAnySymbol(input) {
  const market = normalizeMarketSymbol(input);
  if (market) return market.symbol;
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return '';
  if (/^\d{4,5}$/.test(raw)) return `HKEX:${raw.padStart(5, '0')}`;
  return `KRX:${normalizeKoreaSymbol(raw)}`;
}

function koreaCode(symbol) {
  const raw = String(symbol || '').toUpperCase();
  if (!raw.startsWith('KRX:')) return null;
  return normalizeKoreaSymbol(raw);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });

  const symbols = String(event.queryStringParameters?.symbols || '')
    .split(',')
    .map(normalizeAnySymbol)
    .filter(Boolean)
    .slice(0, 40);
  const includeHistory = String(event.queryStringParameters?.history || '0') === '1';

  if (!symbols.length) return json(400, { error: 'Missing symbols' });

  const koreaCodes = [...new Set(symbols.map(koreaCode).filter(Boolean))];
  const sinaMetas = [...new Map(symbols.map(normalizeMarketSymbol).filter(Boolean).map(meta => [meta.symbol, meta])).values()];
  const stockCodes = [...new Set(koreaCodes.filter(code => endTypeFor(code) === 'stock'))];
  const indexCodes = [...new Set(koreaCodes.filter(code => endTypeFor(code) === 'index'))];
  const errors = [];
  const quotes = [];

  try {
    const [stockItems, indexItems, sinaQuotes] = await Promise.all([
      fetchRealtime(stockCodes, 'stock').catch(error => { if (stockCodes.length) errors.push({ group: 'KRX stock', message: error.message }); return {}; }),
      fetchRealtime(indexCodes, 'index').catch(error => { if (indexCodes.length) errors.push({ group: 'KRX index', message: error.message }); return {}; }),
      fetchSinaQuotes(sinaMetas, includeHistory).catch(error => { if (sinaMetas.length) errors.push({ group: 'HK/A', message: error.message }); return []; })
    ]);
    const itemMap = { ...stockItems, ...indexItems };
    const sinaMap = new Map(sinaQuotes.map(quote => [quote.symbol, quote]));

    for (const symbol of symbols) {
      if (symbol.startsWith('KRX:')) {
        const code = koreaCode(symbol);
        const item = itemMap[code];
        if (!item) {
          errors.push({ symbol, message: 'Naver 未返回该代码' });
          continue;
        }
        const quote = mapRealtimeItem(item, code);
        if (includeHistory && quote.endType === 'stock') {
          const [points, basic] = await Promise.all([fetchDailyPoints(code), fetchBasic(code)]);
          quote.points = points;
          quote.chartImages = basic?.imageChartUrlInfo || null;
          quote.marketTime = basic?.localTradedAt || quote.marketTime;
        } else {
          quote.points = [];
        }
        quotes.push(quote);
      } else {
        const quote = sinaMap.get(symbol);
        if (!quote) errors.push({ symbol, message: 'Sina 未返回该代码' });
        else quotes.push(quote);
      }
    }

    return json(200, { source: 'Naver Stock + Sina Finance', quotes, errors, serverTime: Date.now() });
  } catch (error) {
    return json(502, { error: error?.message || '行情请求失败', quotes, errors, serverTime: Date.now() });
  }
};
