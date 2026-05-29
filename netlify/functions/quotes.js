const {
  json,
  normalizeSymbol,
  endTypeFor,
  fetchRealtime,
  mapRealtimeItem,
  fetchDailyPoints,
  fetchBasic
} = require('./naver-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });

  const symbols = String(event.queryStringParameters?.symbols || '')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean)
    .slice(0, 30);
  const includeHistory = String(event.queryStringParameters?.history || '0') === '1';

  if (!symbols.length) return json(400, { error: 'Missing symbols' });

  const stockCodes = [...new Set(symbols.filter(code => endTypeFor(code) === 'stock'))];
  const indexCodes = [...new Set(symbols.filter(code => endTypeFor(code) === 'index'))];
  const errors = [];
  const quotes = [];

  try {
    const [stockItems, indexItems] = await Promise.all([
      fetchRealtime(stockCodes, 'stock').catch(error => { errors.push({ group: 'stock', message: error.message }); return {}; }),
      fetchRealtime(indexCodes, 'index').catch(error => { errors.push({ group: 'index', message: error.message }); return {}; })
    ]);
    const itemMap = { ...stockItems, ...indexItems };

    for (const code of symbols) {
      const item = itemMap[code];
      if (!item) {
        errors.push({ symbol: code, message: 'Naver 未返回该代码' });
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
    }

    return json(200, { source: 'Naver Stock', quotes, errors, serverTime: Date.now() });
  } catch (error) {
    return json(502, { error: error?.message || 'Naver 请求失败', quotes, errors, serverTime: Date.now() });
  }
};
