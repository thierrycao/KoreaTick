const {
  NAME_ZH,
  json,
  normalizeSymbol,
  endTypeFor,
  toNumber,
  naverGet,
  fetchRealtime,
  fetchDailyPoints,
  mapRealtimeItem
} = require('./naver-client');

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function consecutivePositive(values) {
  let count = 0;
  for (const value of values) {
    if (Number(value) > 0) count += 1;
    else break;
  }
  return count;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function latestAverage(points, size) {
  if (!Array.isArray(points) || points.length < size) return null;
  const window = points.slice(-size).map(point => point.close).filter(Number.isFinite);
  if (window.length < size) return null;
  return sum(window) / size;
}

function parseDealTrend(row = {}) {
  return {
    date: row.bizdate || row.localTradedAt || '',
    close: toNumber(row.closePrice),
    change: toNumber(row.compareToPreviousClosePrice),
    foreigner: toNumber(row.foreignerPureBuyQuant),
    institution: toNumber(row.organPureBuyQuant),
    individual: toNumber(row.individualPureBuyQuant),
    foreignerHoldRatio: toNumber(row.foreignerHoldRatio),
    volume: toNumber(row.accumulatedTradingVolume)
  };
}

function scoreInsight(quote, points, flows) {
  const recent = flows.slice(0, 5);
  const foreigner5 = sum(recent.map(item => item.foreigner));
  const institution5 = sum(recent.map(item => item.institution));
  const individual5 = sum(recent.map(item => item.individual));
  const foreignerStreak = consecutivePositive(flows.map(item => item.foreigner));
  const institutionStreak = consecutivePositive(flows.map(item => item.institution));
  const price = quote?.price;
  const ma5 = latestAverage(points, 5);
  const ma20 = latestAverage(points, 20);
  const highs20 = points.slice(-20).map(point => point.high ?? point.close).filter(Number.isFinite);
  const lows20 = points.slice(-20).map(point => point.low ?? point.close).filter(Number.isFinite);
  const high20 = highs20.length ? Math.max(...highs20) : null;
  const low20 = lows20.length ? Math.min(...lows20) : null;

  let flowScore = 45;
  if (foreigner5 > 0) flowScore += 12;
  if (institution5 > 0) flowScore += 12;
  if (foreigner5 > 0 && institution5 > 0) flowScore += 12;
  flowScore += Math.min(foreignerStreak * 4, 16);
  flowScore += Math.min(institutionStreak * 3, 12);
  if (individual5 > 0 && foreigner5 < 0 && institution5 < 0) flowScore -= 16;
  if (foreigner5 < 0 && institution5 < 0) flowScore -= 18;

  let technicalScore = 45;
  if (Number.isFinite(quote?.changePercent) && quote.changePercent > 0) technicalScore += 10;
  if (Number.isFinite(price) && Number.isFinite(ma5) && price >= ma5) technicalScore += 10;
  if (Number.isFinite(price) && Number.isFinite(ma20) && price >= ma20) technicalScore += 12;
  if (Number.isFinite(ma5) && Number.isFinite(ma20) && ma5 >= ma20) technicalScore += 10;
  if (Number.isFinite(price) && Number.isFinite(high20) && price >= high20 * 0.97) technicalScore += 8;
  if (Number.isFinite(price) && Number.isFinite(low20) && price <= low20 * 1.05) technicalScore -= 8;

  let riskScore = 70;
  if (Number.isFinite(quote?.changePercent) && Math.abs(quote.changePercent) > 8) riskScore -= 18;
  if (Number.isFinite(price) && Number.isFinite(ma20) && price > ma20 * 1.18) riskScore -= 15;
  if (Number.isFinite(foreigner5) && foreigner5 < 0) riskScore -= 8;

  const totalScore = Math.round(clamp(clamp(flowScore) * 0.45 + clamp(technicalScore) * 0.4 + clamp(riskScore) * 0.15));
  const status = totalScore >= 82 ? '强关注' : totalScore >= 72 ? '等触发' : totalScore >= 60 ? '观察' : '回避';
  const action = totalScore >= 82 ? '可小仓，但必须等买点触发' : totalScore >= 72 ? '等突破或回踩确认' : totalScore >= 60 ? '只观察，不追涨' : '暂不纳入本周候选';
  const breakoutBuy = Number.isFinite(high20) ? Math.round(high20 * 1.005) : null;
  const pullbackBuy = Number.isFinite(ma5) ? Math.round(ma5) : null;
  const stopLoss = Number.isFinite(price) && Number.isFinite(low20) ? Math.round(Math.max(price * 0.92, low20 * 0.985)) : (Number.isFinite(price) ? Math.round(price * 0.92) : null);
  const takeProfit = Number.isFinite(price) ? Math.round(price * 1.14) : null;

  const reasons = [];
  if (foreignerStreak >= 3) reasons.push(`外资连续 ${foreignerStreak} 日净买入`);
  if (institutionStreak >= 3) reasons.push(`机构连续 ${institutionStreak} 日净买入`);
  if (foreigner5 > 0 && institution5 > 0) reasons.push('外资与机构近5日同向流入');
  if (Number.isFinite(price) && Number.isFinite(ma20) && price >= ma20) reasons.push('价格站上20日均线');
  if (individual5 > 0 && foreigner5 < 0 && institution5 < 0) reasons.push('个人资金承接、主力流出，谨慎追涨');
  if (!reasons.length) reasons.push('资金和技术信号尚未形成共振');

  return {
    totalScore,
    flowScore: Math.round(clamp(flowScore)),
    technicalScore: Math.round(clamp(technicalScore)),
    riskScore: Math.round(clamp(riskScore)),
    status,
    action,
    reasons,
    flow: {
      foreigner5,
      institution5,
      individual5,
      foreignerStreak,
      institutionStreak
    },
    levels: {
      breakoutBuy,
      pullbackBuy,
      stopLoss,
      takeProfit,
      ma5: Number.isFinite(ma5) ? Math.round(ma5) : null,
      ma20: Number.isFinite(ma20) ? Math.round(ma20) : null,
      high20,
      low20
    }
  };
}

async function fetchIntegration(code) {
  const data = await naverGet('/stock/domestic/integration', { code, endType: 'stock' });
  return data?.result || {};
}

async function buildInsight(code, realtimeItem) {
  const quote = mapRealtimeItem(realtimeItem, code);
  quote.name = NAME_ZH[code] || quote.name;
  const [integration, points] = await Promise.all([
    fetchIntegration(code).catch(() => ({})),
    fetchDailyPoints(code, 50).catch(() => [])
  ]);
  const flows = (integration.dealTrendInfos || []).map(parseDealTrend).filter(item => item.date).slice(0, 20);
  const insight = scoreInsight(quote, points, flows);
  return {
    symbol: quote.symbol,
    code,
    name: quote.name,
    originalName: quote.originalName,
    price: quote.price,
    changePercent: quote.changePercent,
    currency: quote.currency,
    currency: quote.currency,
    exchange: quote.exchange,
    marketStatus: quote.marketStatus,
    quote,
    flows,
    insight
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });

  const codes = [...new Set(String(event.queryStringParameters?.symbols || '')
    .split(',')
    .map(normalizeSymbol)
    .filter(code => endTypeFor(code) === 'stock'))]
    .slice(0, 12);

  if (!codes.length) return json(400, { error: 'Missing stock symbols' });

  try {
    const items = await fetchRealtime(codes, 'stock');
    const settled = await Promise.allSettled(codes.map(code => items[code] ? buildInsight(code, items[code]) : null));
    const insights = [];
    const errors = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) insights.push(result.value);
      else errors.push({ symbol: codes[index], message: result.reason?.message || '未取得资金数据' });
    });
    insights.sort((a, b) => b.insight.totalScore - a.insight.totalScore);
    return json(200, {
      source: 'Naver Stock',
      generatedAt: new Date().toISOString(),
      insights,
      errors,
      note: '评分仅用于观察和纪律提示，不构成投资建议。'
    });
  } catch (error) {
    return json(502, { error: error?.message || 'Naver 请求失败', insights: [], errors: [], serverTime: Date.now() });
  }
};
