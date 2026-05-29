const { NAME_ZH, json, naverGet, mapRealtimeItem } = require('./naver-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  const category = String(event.queryStringParameters?.category || 'all');
  const pageSize = Math.min(Math.max(Number(event.queryStringParameters?.pageSize || 40), 1), 80);
  try {
    const data = await naverGet('/domestic/stock/list', {
      sortType: 'marketValue',
      category: ['all', 'KOSPI', 'KOSDAQ'].includes(category) ? category : 'all',
      domesticStockExchangeType: 'KRX',
      page: 1,
      pageSize
    });
    const result = data?.result || {};
    const stocks = (result.stocks || []).map(item => {
      const quote = mapRealtimeItem(item, item.itemCode || item.id);
      quote.name = NAME_ZH[quote.code] || quote.name;
      return quote;
    });
    return json(200, {
      source: 'Naver Stock',
      marketStatus: result.marketStatus || '',
      totalCount: result.totalCount || stocks.length,
      stocks,
      serverTime: Date.now()
    });
  } catch (error) {
    return json(502, { error: error?.message || 'Naver 请求失败', stocks: [], serverTime: Date.now() });
  }
};
