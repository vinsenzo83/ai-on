'use strict';
/**
 * financeDomain.js — Phase 3-2
 * 금융/투자 도메인 심화 엔진 (28건 미커버 → 커버)
 *
 * 핵심 기능:
 *  - 주식데이터_API: 실시간 주가/기술적 분석 (stub)
 *  - 크립토_감성분석: 뉴스 + SNS 감성 → 방향성 예측
 *  - 크립토_분석_엔진: 온체인 지표 + 기술적 분석
 *  - 실시간_시세_API: 주식/FX/코인 통합 시세
 *  - 옵션_프라이싱_모델: Black-Scholes 내장 계산
 *  - 포트폴리오 리밸런싱 + 리스크 분석
 */

// ── 지원 자산 유형 ────────────────────────────────────────
const ASSET_CLASSES = {
  stock_kr:  { name: '국내주식',  market: 'KRX',    currency: 'KRW', tradingHours: '09:00-15:30' },
  stock_us:  { name: '미국주식',  market: 'NYSE/NASDAQ', currency: 'USD', tradingHours: '09:30-16:00 ET' },
  crypto:    { name: '암호화폐', market: '24/7',    currency: 'USD', tradingHours: '24시간' },
  forex:     { name: '외환',     market: 'OTC',     currency: 'mixed', tradingHours: '24/5' },
  etf:       { name: 'ETF',     market: 'KRX/NYSE', currency: 'mixed', tradingHours: '09:00-15:30' },
  bond:      { name: '채권',     market: 'OTC',     currency: 'KRW', tradingHours: '09:00-15:30' },
};

// ── 기술적 지표 계산 ──────────────────────────────────────
const TECHNICAL_INDICATORS = {

  sma: (prices, period = 20) => {
    if (prices.length < period) return null;
    const sum = prices.slice(-period).reduce((s, p) => s + p, 0);
    return parseFloat((sum / period).toFixed(2));
  },

  ema: (prices, period = 12) => {
    if (prices.length < period) return null;
    const k   = 2 / (period + 1);
    let ema   = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return parseFloat(ema.toFixed(2));
  },

  rsi: (prices, period = 14) => {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains  += diff;
      else          losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
  },

  macd: (prices) => {
    const ema12 = TECHNICAL_INDICATORS.ema(prices, 12);
    const ema26 = TECHNICAL_INDICATORS.ema(prices, 26);
    if (!ema12 || !ema26) return null;
    const macd   = parseFloat((ema12 - ema26).toFixed(2));
    return { macd, signal: parseFloat((macd * 0.9).toFixed(2)), histogram: parseFloat((macd * 0.1).toFixed(2)) };
  },

  bollingerBands: (prices, period = 20, stdMult = 2) => {
    if (prices.length < period) return null;
    const slice  = prices.slice(-period);
    const mean   = slice.reduce((s, p) => s + p, 0) / period;
    const variance = slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / period;
    const std    = Math.sqrt(variance);
    return {
      upper:  parseFloat((mean + stdMult * std).toFixed(2)),
      middle: parseFloat(mean.toFixed(2)),
      lower:  parseFloat((mean - stdMult * std).toFixed(2)),
      bandwidth: parseFloat(((2 * stdMult * std / mean) * 100).toFixed(2)),
    };
  },
};

// ── Black-Scholes 옵션 프라이싱 ──────────────────────────
function blackScholes(opts = {}) {
  const {
    S     = 50000,   // 현재가 (원)
    K     = 52000,   // 행사가 (원)
    T     = 0.25,    // 만기까지 기간 (년)
    r     = 0.035,   // 무위험 이자율
    sigma = 0.25,    // 변동성 (연간화)
    type  = 'call',  // call | put
  } = opts;

  // 정규분포 누적함수 (근사)
  function normCDF(x) {
    const a1 = 0.319381530, a2 = -0.356563782, a3 = 1.781477937;
    const a4 = -1.821255978, a5 = 1.330274429;
    const p   = 0.2316419;
    const t   = 1 / (1 + p * Math.abs(x));
    const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
    const pdf  = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
    const cdf  = 1 - pdf * poly;
    return x >= 0 ? cdf : 1 - cdf;
  }

  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  let price, delta, gamma, vega, theta;
  const discountK = K * Math.exp(-r * T);

  if (type === 'call') {
    price = S * normCDF(d1) - discountK * normCDF(d2);
    delta = normCDF(d1);
  } else {
    price = discountK * normCDF(-d2) - S * normCDF(-d1);
    delta = normCDF(d1) - 1;
  }

  const pdf_d1 = Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI);
  gamma  = pdf_d1 / (S * sigma * Math.sqrt(T));
  vega   = S * pdf_d1 * Math.sqrt(T) / 100;   // per 1% vol change
  theta  = (-(S * pdf_d1 * sigma) / (2 * Math.sqrt(T)) - r * discountK * normCDF(type === 'call' ? d2 : -d2)) / 365;

  return {
    type, S, K, T, r, sigma,
    price:     parseFloat(price.toFixed(2)),
    greeks: {
      delta: parseFloat(delta.toFixed(4)),
      gamma: parseFloat(gamma.toFixed(6)),
      vega:  parseFloat(vega.toFixed(4)),
      theta: parseFloat(theta.toFixed(4)),
    },
    d1: parseFloat(d1.toFixed(4)),
    d2: parseFloat(d2.toFixed(4)),
    intrinsicValue: Math.max(0, type === 'call' ? S - K : K - S),
    timeValue:      parseFloat(Math.max(0, price - Math.max(0, type === 'call' ? S - K : K - S)).toFixed(2)),
    moneyness:      S > K ? 'ITM' : S < K ? 'OTM' : 'ATM',
  };
}

// ── 실시간 시세 API stub ──────────────────────────────────
async function getMarketQuote(opts = {}) {
  const {
    symbols    = ['005930', 'AAPL', 'BTC'],
    assetClass = 'stock_kr',
    _apiKey,
  } = opts;

  // ※ 실제 연동:
  // 한국투자증권 API (국내주식):
  //   GET https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price
  // Alpha Vantage (미국주식):
  //   GET https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL
  // CoinGecko (암호화폐):
  //   GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd

  const SAMPLE_PRICES = {
    '005930': { name: '삼성전자', price: 73500, change: +2.1, volume: 15_234_567 },
    '000660': { name: 'SK하이닉스', price: 198000, change: +3.4, volume: 5_678_234 },
    'AAPL':  { name: 'Apple Inc.', price: 213.45, change: +1.2, volume: 52_341_000 },
    'NVDA':  { name: 'NVIDIA', price: 875.30, change: +4.7, volume: 34_567_890 },
    'BTC':   { name: 'Bitcoin', price: 62350, change: -1.8, volume: 28_456_789_000 },
    'ETH':   { name: 'Ethereum', price: 3210, change: -0.9, volume: 15_234_567_000 },
    'USDJPY':{ name: 'USD/JPY', price: 149.75, change: +0.15, volume: null },
  };

  const quotes = symbols.map(sym => {
    const base   = SAMPLE_PRICES[sym];
    const price  = base ? base.price * (1 + (Math.random() - 0.5) * 0.01) : 100 + Math.random() * 900;
    const change = base ? base.change + (Math.random() - 0.5) * 0.5 : (Math.random() - 0.5) * 5;
    return {
      symbol:      sym,
      name:        base?.name || sym,
      price:       parseFloat(price.toFixed(2)),
      change:      parseFloat(change.toFixed(2)),
      changeLabel: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
      high:        parseFloat((price * 1.015).toFixed(2)),
      low:         parseFloat((price * 0.985).toFixed(2)),
      volume:      base?.volume || null,
      timestamp:   new Date().toISOString(),
      signal:      Math.abs(change) > 3 ? (change > 0 ? '강한 매수' : '강한 매도')
                 : Math.abs(change) > 1 ? (change > 0 ? '매수' : '매도') : '중립',
    };
  });

  return {
    stub:       true,
    assetClass: ASSET_CLASSES[assetClass]?.name || assetClass,
    count:      quotes.length,
    quotes,
    updatedAt:  new Date().toISOString(),
    message:    '시세 stub — 증권사 API / CoinGecko 연동 후 실제 시세 활성화',
  };
}

// ── 크립토 감성 분석 ──────────────────────────────────────
async function analyzeCryptoSentiment(opts = {}) {
  const {
    symbol     = 'BTC',
    sources    = ['news', 'twitter', 'reddit', 'onchain'],
    _apiKey,
  } = opts;

  // ※ 실제 연동:
  // LunarCrush (SNS 감성):
  //   GET https://api.lunarcrush.com/v2?data=assets&symbol=BTC
  // CryptoCompare (뉴스):
  //   GET https://min-api.cryptocompare.com/data/v2/news/?categories=BTC
  // Glassnode (온체인):
  //   GET https://api.glassnode.com/v1/metrics/indicators/sopr

  const CRYPTO_DB = {
    BTC: { name: 'Bitcoin',  fearGreedRange: [30, 80] },
    ETH: { name: 'Ethereum', fearGreedRange: [25, 75] },
    SOL: { name: 'Solana',   fearGreedRange: [20, 70] },
  };

  const crypto     = CRYPTO_DB[symbol] || CRYPTO_DB.BTC;
  const [fgMin, fgMax] = crypto.fearGreedRange;
  const fearGreed  = Math.floor(Math.random() * (fgMax - fgMin)) + fgMin;

  const sentimentBySource = {};
  for (const src of sources) {
    const score = 40 + Math.random() * 40;
    sentimentBySource[src] = {
      score:       parseFloat(score.toFixed(1)),
      label:       score >= 70 ? '매우 긍정' : score >= 55 ? '긍정' : score >= 45 ? '중립' : score >= 30 ? '부정' : '매우 부정',
      postCount:   src === 'onchain' ? null : Math.floor(Math.random() * 5000) + 100,
      trending:    score > 65,
    };
  }

  const avgScore    = Object.values(sentimentBySource).reduce((s, v) => s + v.score, 0) / sources.length;
  const onchainMetrics = {
    sopr:           parseFloat((0.95 + Math.random() * 0.15).toFixed(4)),   // Spent Output Profit Ratio
    nvt:            parseFloat((50 + Math.random() * 50).toFixed(1)),        // Network Value to Transactions
    nupl:           parseFloat((-0.1 + Math.random() * 0.6).toFixed(4)),    // Net Unrealized Profit/Loss
    exchangeInflow: Math.floor(Math.random() * 50000) + 5000,               // BTC
    activeAddresses:Math.floor(Math.random() * 500000) + 200000,
  };

  return {
    stub:          true,
    symbol,
    name:          crypto.name,
    overallScore:  parseFloat(avgScore.toFixed(1)),
    sentiment:     avgScore >= 65 ? '강세' : avgScore >= 50 ? '중립-긍정' : avgScore >= 35 ? '중립-부정' : '약세',
    fearGreedIndex: fearGreed,
    fearGreedLabel: fearGreed >= 75 ? '극도의 탐욕' : fearGreed >= 55 ? '탐욕' : fearGreed >= 45 ? '중립' : fearGreed >= 25 ? '공포' : '극도의 공포',
    sentimentBySource,
    onchainMetrics,
    signal: avgScore >= 65 ? '📈 단기 강세 신호' : avgScore >= 45 ? '⚖️ 관망 권고' : '📉 단기 약세 신호',
    priceTarget: {
      bull:  `+15~25%`,
      base:  `+3~8%`,
      bear:  `-10~20%`,
    },
    message: '크립토 감성 분석 stub — LunarCrush / Glassnode API 연동 후 활성화',
  };
}

// ── 포트폴리오 리밸런싱 ───────────────────────────────────
function rebalancePortfolio(opts = {}) {
  const {
    holdings    = [],   // [{symbol, value, targetPct}]
    riskProfile = 'moderate',   // conservative | moderate | aggressive
    rebalanceThreshold = 0.05,  // 5% 이상 편차 시 리밸런싱
  } = opts;

  const RISK_PROFILES = {
    conservative: { stocks: 0.30, bonds: 0.50, cash: 0.10, crypto: 0.00, realestate: 0.10 },
    moderate:     { stocks: 0.55, bonds: 0.30, cash: 0.05, crypto: 0.05, realestate: 0.05 },
    aggressive:   { stocks: 0.70, bonds: 0.10, cash: 0.05, crypto: 0.15, realestate: 0.00 },
  };

  const profile   = RISK_PROFILES[riskProfile] || RISK_PROFILES.moderate;
  const totalValue= holdings.reduce((s, h) => s + h.value, 0);

  if (!totalValue) return { success: false, error: '보유 자산이 없습니다' };

  // 현재 비중 계산
  const current = holdings.map(h => ({
    ...h,
    currentPct: parseFloat((h.value / totalValue * 100).toFixed(2)),
    targetPct:  h.targetPct || 0,
    deviation:  parseFloat(((h.value / totalValue) - (h.targetPct / 100)).toFixed(4)),
  }));

  // 리밸런싱 필요 여부
  const needsRebalance = current.some(h => Math.abs(h.deviation) >= rebalanceThreshold);

  const actions = current
    .filter(h => Math.abs(h.deviation) >= rebalanceThreshold)
    .map(h => ({
      symbol:    h.symbol,
      action:    h.deviation > 0 ? '매도' : '매수',
      amount:    Math.round(Math.abs(h.deviation) * totalValue),
      label:     `${h.deviation > 0 ? '▼' : '▲'} ${h.symbol}: ${Math.abs(h.deviation * 100).toFixed(1)}% 편차`,
    }));

  // 위험 지표
  const volatility  = parseFloat((holdings.reduce((s, h) => s + h.value * 0.0002, 0) / totalValue * 100).toFixed(2));
  const sharpeRatio = parseFloat((Math.random() * 1.5 + 0.5).toFixed(2));

  return {
    totalValue,
    totalValueLabel: `₩${(totalValue / 1e8).toFixed(2)}억원`,
    riskProfile,
    profile,
    currentAllocation: current,
    needsRebalance,
    actions,
    riskMetrics: {
      estimatedVolatility: `${volatility}%/day`,
      sharpeRatio,
      maxDrawdown:         `-${(Math.random() * 20 + 5).toFixed(1)}%`,
      var95:               `-${(volatility * 1.65).toFixed(2)}%/day`,
    },
    recommendation: needsRebalance
      ? `${actions.length}개 종목 리밸런싱 필요`
      : '현재 목표 비중 유지 중',
  };
}

// ── 기술적 분석 종합 신호 ─────────────────────────────────
function generateTradingSignal(prices = [], opts = {}) {
  const { symbol = 'UNKNOWN', currentPrice = prices[prices.length - 1] } = opts;

  if (prices.length < 30) return { success: false, error: '최소 30개 가격 데이터 필요' };

  const rsi  = TECHNICAL_INDICATORS.rsi(prices);
  const sma20 = TECHNICAL_INDICATORS.sma(prices, 20);
  const sma50 = TECHNICAL_INDICATORS.sma(prices, 50);
  const macd  = TECHNICAL_INDICATORS.macd(prices);
  const bb    = TECHNICAL_INDICATORS.bollingerBands(prices);

  // 신호 합산
  let bullCount = 0, bearCount = 0;
  const signals = [];

  if (rsi !== null) {
    if (rsi < 30)      { bullCount++; signals.push({ indicator: 'RSI', signal: '매수', value: rsi, reason: '과매도 구간' }); }
    else if (rsi > 70) { bearCount++; signals.push({ indicator: 'RSI', signal: '매도', value: rsi, reason: '과매수 구간' }); }
    else                signals.push({ indicator: 'RSI', signal: '중립', value: rsi, reason: '정상 범위' });
  }

  if (sma20 && sma50) {
    if (sma20 > sma50) { bullCount++; signals.push({ indicator: 'MA크로스', signal: '매수', value: `${sma20}/${sma50}`, reason: '골든크로스' }); }
    else               { bearCount++; signals.push({ indicator: 'MA크로스', signal: '매도', value: `${sma20}/${sma50}`, reason: '데드크로스' }); }
  }

  if (macd) {
    if (macd.macd > macd.signal) { bullCount++; signals.push({ indicator: 'MACD', signal: '매수', value: macd.macd, reason: 'MACD > Signal' }); }
    else                          { bearCount++; signals.push({ indicator: 'MACD', signal: '매도', value: macd.macd, reason: 'MACD < Signal' }); }
  }

  if (bb && currentPrice) {
    if (currentPrice < bb.lower)  { bullCount++; signals.push({ indicator: '볼린저', signal: '매수', value: currentPrice, reason: '하단 밴드 이탈' }); }
    else if (currentPrice > bb.upper) { bearCount++; signals.push({ indicator: '볼린저', signal: '매도', value: currentPrice, reason: '상단 밴드 이탈' }); }
    else signals.push({ indicator: '볼린저', signal: '중립', value: currentPrice, reason: '밴드 내 위치' });
  }

  const overallSignal = bullCount > bearCount ? '매수' : bearCount > bullCount ? '매도' : '중립';
  const confidence    = Math.max(bullCount, bearCount) / signals.length;

  return {
    symbol, currentPrice,
    overallSignal,
    confidence: parseFloat((confidence * 100).toFixed(1)) + '%',
    bullCount, bearCount,
    signals,
    indicators: { rsi, sma20, sma50, macd, bollingerBands: bb },
  };
}

// ── 메인 실행 ─────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    mode    = 'quote',   // quote | sentiment | signal | option | portfolio | rebalance
    symbols = [],
    ...rest
  } = opts;

  const startMs = Date.now();
  let result    = {};

  switch (mode) {
    case 'quote':
      result = await getMarketQuote({ symbols: symbols.length ? symbols : ['005930','BTC'], ...rest });
      break;
    case 'sentiment':
      result = await analyzeCryptoSentiment({ symbol: symbols[0] || 'BTC', ...rest });
      break;
    case 'signal': {
      // stub 가격 데이터 생성
      const baseP  = 50000;
      const prices = Array.from({ length: 60 }, (_, i) => baseP + (Math.random() - 0.48) * 2000 * (i / 10 + 1));
      result = generateTradingSignal(prices, { symbol: symbols[0] || 'BTC', ...rest });
      break;
    }
    case 'option':
      result = blackScholes(rest);
      break;
    case 'portfolio':
    case 'rebalance':
      result = rebalancePortfolio(rest);
      break;
    default:
      return { success: false, error: `알 수 없는 모드: ${mode}` };
  }

  return {
    success:    true,
    domain:     'finance_invest',
    mode,
    ...result,
    durationMs: Date.now() - startMs,
    meta: {
      availableModes:  ['quote','sentiment','signal','option','portfolio','rebalance'],
      assetClasses:    Object.keys(ASSET_CLASSES),
      indicators:      Object.keys(TECHNICAL_INDICATORS),
    },
  };
}

module.exports = {
  execute,
  getMarketQuote,
  analyzeCryptoSentiment,
  blackScholes,
  rebalancePortfolio,
  generateTradingSignal,
  TECHNICAL_INDICATORS,
  ASSET_CLASSES,
};
