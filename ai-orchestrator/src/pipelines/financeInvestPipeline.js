'use strict';
/**
 * financeInvestPipeline.js — Phase 5-Finance
 * 금융/투자 도메인 28건 커버
 */

const STOCK_INDICES = {
  KOSPI:  { name: '코스피', baseValue: 2650, volatility: 0.012 },
  KOSDAQ: { name: '코스닥', baseValue: 870,  volatility: 0.018 },
  SP500:  { name: 'S&P500', baseValue: 5100, volatility: 0.010 },
  NASDAQ: { name: '나스닥', baseValue: 16200, volatility: 0.015 },
};

const CRYPTO_LIST = {
  BTC: { name: 'Bitcoin',  basePrice: 85000, marketCapB: 1680 },
  ETH: { name: 'Ethereum', basePrice: 3200,  marketCapB: 385 },
  SOL: { name: 'Solana',   basePrice: 165,   marketCapB: 75 },
  XRP: { name: 'XRP',      basePrice: 0.62,  marketCapB: 68 },
};

const SECTOR_MAP = {
  tech:     { label: 'IT/기술', pe: 28, growthRate: 0.15 },
  finance:  { label: '금융',   pe: 12, growthRate: 0.05 },
  bio:      { label: '바이오', pe: 45, growthRate: 0.22 },
  energy:   { label: '에너지', pe: 15, growthRate: 0.08 },
  consumer: { label: '소비재', pe: 18, growthRate: 0.07 },
};

// 1. 주식 데이터 & 기술적 분석
function analyzeStock(params = {}) {
  const symbol = params.symbol || 'SAMSUNG';
  const period = params.period || '3m';
  const basePrice = params.basePrice || 75000;

  const days = { '1m': 22, '3m': 66, '6m': 132, '1y': 252 }[period] || 66;
  const priceHistory = Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - i));
    const change = (Math.random() - 0.48) * basePrice * 0.025;
    const price = Math.round(basePrice * (0.85 + i / days * 0.3) + change);
    return { date: date.toISOString().slice(0, 10), price, volume: Math.floor(Math.random() * 5000000 + 500000) };
  });

  const currentPrice = priceHistory[priceHistory.length - 1].price;
  const startPrice = priceHistory[0].price;
  const returnPct = ((currentPrice - startPrice) / startPrice * 100).toFixed(2);

  const ma20 = Math.round(priceHistory.slice(-20).reduce((a, p) => a + p.price, 0) / 20);
  const ma60 = Math.round(priceHistory.slice(-60).reduce((a, p) => a + p.price, 0) / Math.min(60, priceHistory.length));

  return {
    symbol,
    currentPrice,
    period,
    priceChange: (currentPrice - startPrice),
    returnPct: returnPct + '%',
    technicals: {
      ma20, ma60,
      trend: currentPrice > ma20 ? '단기 상승' : '단기 하락',
      rsi: Math.floor(Math.random() * 40 + 35),
      macd: (Math.random() * 200 - 100).toFixed(0),
      bollingerBand: { upper: Math.round(currentPrice * 1.05), lower: Math.round(currentPrice * 0.95) },
    },
    priceHistory: priceHistory.slice(-10),
    volume: { avg: Math.floor(Math.random() * 3000000 + 800000), latest: priceHistory.slice(-1)[0].volume },
    valuation: { pe: (Math.random() * 20 + 10).toFixed(1), pb: (Math.random() * 2 + 1).toFixed(1) },
    analyst: { targetPrice: Math.round(currentPrice * (1.05 + Math.random() * 0.2)), consensus: '매수' },
  };
}

// 2. 포트폴리오 분석
function analyzePortfolio(params = {}) {
  const holdings = params.holdings || [
    { symbol: 'SAMSUNG', name: '삼성전자', shares: 10, buyPrice: 68000 },
    { symbol: 'KAKAO',   name: '카카오',   shares: 5,  buyPrice: 52000 },
    { symbol: 'NAVER',   name: '네이버',   shares: 3,  buyPrice: 185000 },
  ];

  const currentPrices = { SAMSUNG: 75000, KAKAO: 48000, NAVER: 195000 };

  const positions = holdings.map(h => {
    const currentP = currentPrices[h.symbol] || h.buyPrice * (0.9 + Math.random() * 0.3);
    const value = Math.round(currentP * h.shares);
    const pnl = Math.round((currentP - h.buyPrice) * h.shares);
    const pnlPct = ((currentP - h.buyPrice) / h.buyPrice * 100).toFixed(2);
    return { ...h, currentPrice: currentP, value, pnl, pnlPct: pnlPct + '%' };
  });

  const totalValue = positions.reduce((a, p) => a + p.value, 0);
  const totalCost = holdings.reduce((a, h) => a + h.buyPrice * h.shares, 0);
  const totalPnl = totalValue - totalCost;

  return {
    totalValue,
    totalCost,
    totalPnl,
    totalReturn: ((totalPnl / totalCost) * 100).toFixed(2) + '%',
    positions,
    allocation: positions.map(p => ({ symbol: p.symbol, weight: (p.value / totalValue * 100).toFixed(1) + '%' })),
    riskMetrics: {
      beta: (0.8 + Math.random() * 0.6).toFixed(2),
      sharpe: (0.5 + Math.random() * 1.5).toFixed(2),
      maxDrawdown: '-' + (5 + Math.random() * 20).toFixed(1) + '%',
      volatility: (10 + Math.random() * 15).toFixed(1) + '%',
    },
    diversificationScore: Math.floor(Math.random() * 30 + 55),
    rebalanceRecommendation: '기술주 비중 과다 — 금융/에너지 추가 권장',
  };
}

// 3. 크립토 분석
function analyzeCrypto(params = {}) {
  const symbol = params.symbol || 'BTC';
  const cryptoInfo = CRYPTO_LIST[symbol] || CRYPTO_LIST.BTC;

  const variation = 0.85 + Math.random() * 0.3;
  const currentPrice = cryptoInfo.basePrice * variation;
  const change24h = (Math.random() * 10 - 5).toFixed(2);
  const change7d = (Math.random() * 20 - 10).toFixed(2);

  const fearGreedIndex = Math.floor(Math.random() * 100);
  const sentiment = fearGreedIndex > 75 ? '극도 탐욕' : fearGreedIndex > 55 ? '탐욕' : fearGreedIndex > 45 ? '중립' : fearGreedIndex > 25 ? '공포' : '극도 공포';

  return {
    symbol,
    name: cryptoInfo.name,
    currentPrice: Math.round(currentPrice),
    change24h: change24h + '%',
    change7d: change7d + '%',
    marketCap: Math.round(cryptoInfo.marketCapB * variation) + 'B USD',
    volume24h: Math.round(cryptoInfo.basePrice * 50000) + ' USD',
    dominance: symbol === 'BTC' ? '52.3%' : symbol === 'ETH' ? '16.8%' : '2.1%',
    technicals: {
      rsi: Math.floor(Math.random() * 40 + 30),
      ma50: Math.round(currentPrice * (0.9 + Math.random() * 0.2)),
      supportLevel: Math.round(currentPrice * 0.88),
      resistanceLevel: Math.round(currentPrice * 1.12),
    },
    onChain: {
      activeAddresses: Math.floor(Math.random() * 500000 + 800000),
      networkHashrate: '580 EH/s',
      mempoolSize: Math.floor(Math.random() * 50000 + 5000) + ' txs',
    },
    sentiment: { fearGreedIndex, status: sentiment },
    socialVolume: Math.floor(Math.random() * 200000 + 50000) + ' mentions/day',
    priceTarget: { bull: Math.round(currentPrice * 1.5), bear: Math.round(currentPrice * 0.6), base: Math.round(currentPrice * 1.1) },
  };
}

// 4. 옵션 프라이싱 (Black-Scholes)
function priceOption(params = {}) {
  const S = params.S || 100;     // 주가
  const K = params.K || 105;     // 행사가
  const T = params.T || 0.5;     // 만기(년)
  const r = params.r || 0.03;    // 무위험 이자율
  const sigma = params.sigma || 0.25; // 변동성
  const optionType = params.type || 'call';

  // Black-Scholes
  function normalCDF(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? y : 1 - y;
  }

  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  let price, delta, gamma, theta, vega, rho;

  if (optionType === 'call') {
    price = S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
    delta = normalCDF(d1);
    rho = K * T * Math.exp(-r * T) * normalCDF(d2) / 100;
  } else {
    price = K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
    delta = normalCDF(d1) - 1;
    rho = -K * T * Math.exp(-r * T) * normalCDF(-d2) / 100;
  }

  gamma = Math.exp(-(d1 * d1) / 2) / (S * sigma * Math.sqrt(T) * Math.sqrt(2 * Math.PI));
  theta = (-S * Math.exp(-(d1 * d1) / 2) * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normalCDF(optionType === 'call' ? d2 : -d2)) / 365;
  vega = S * Math.exp(-(d1 * d1) / 2) * Math.sqrt(T) / (100 * Math.sqrt(2 * Math.PI));

  return {
    inputs: { S, K, T, r, sigma, type: optionType },
    price: Math.round(price * 100) / 100,
    intrinsicValue: Math.max(0, optionType === 'call' ? S - K : K - S),
    timeValue: Math.round((price - Math.max(0, optionType === 'call' ? S - K : K - S)) * 100) / 100,
    greeks: {
      delta: Math.round(delta * 10000) / 10000,
      gamma: Math.round(gamma * 10000) / 10000,
      theta: Math.round(theta * 10000) / 10000,
      vega: Math.round(vega * 10000) / 10000,
      rho: Math.round(rho * 10000) / 10000,
    },
    impliedVolatility: (sigma * 100).toFixed(1) + '%',
    moneyness: S > K ? 'ITM' : S < K ? 'OTM' : 'ATM',
    breakEven: optionType === 'call' ? K + price : K - price,
  };
}

// 5. 신용평가 모델
function evaluateCredit(params = {}) {
  const annual_revenue = params.annualRevenue || 5000000000;
  const debt_ratio = params.debtRatio || 0.45;
  const years_in_business = params.yearsInBusiness || 8;
  const industry = params.industry || 'tech';
  const late_payments = params.latePayments || 0;

  const sectorInfo = SECTOR_MAP[industry] || SECTOR_MAP.tech;

  let score = 600;
  // 매출 점수
  if (annual_revenue > 10000000000) score += 80;
  else if (annual_revenue > 1000000000) score += 50;
  else if (annual_revenue > 100000000) score += 20;
  // 부채 비율
  if (debt_ratio < 0.3) score += 60;
  else if (debt_ratio < 0.5) score += 30;
  else if (debt_ratio > 0.8) score -= 50;
  // 업력
  if (years_in_business > 10) score += 50;
  else if (years_in_business > 5) score += 30;
  else score += 10;
  // 연체
  score -= late_payments * 30;
  // 섹터 보정
  score += (sectorInfo.growthRate * 100).toFixed(0) * 1;

  score = Math.min(950, Math.max(300, score));
  const grade = score >= 900 ? 'AAA' : score >= 850 ? 'AA+' : score >= 800 ? 'AA' : score >= 750 ? 'A+' : score >= 700 ? 'A' : score >= 650 ? 'BBB' : score >= 600 ? 'BB' : 'B';

  return {
    creditScore: score,
    grade,
    outlook: score > 750 ? 'positive' : score > 650 ? 'stable' : 'negative',
    factors: {
      revenueScore: Math.floor(annual_revenue / 100000000) > 50 ? '우수' : '보통',
      debtScore: debt_ratio < 0.5 ? '안전' : '주의',
      historyScore: years_in_business > 5 ? '양호' : '부족',
      paymentScore: late_payments === 0 ? '완벽' : '주의',
    },
    loanEligibility: {
      maxLoanAmount: Math.round(annual_revenue * (grade.startsWith('A') ? 0.8 : 0.5)),
      recommendedRate: grade.startsWith('A') ? '3.5~4.5%' : '5.5~7.5%',
      term: '12~60개월',
    },
    recommendation: grade.startsWith('A') ? '우량 고객 — 프리미엄 금융 상품 권장' : '일반 고객 — 표준 심사 절차 진행',
  };
}

async function execute(action, params = {}) {
  switch (action) {
    case 'analyzeStock':    return analyzeStock(params);
    case 'analyzePortfolio': return analyzePortfolio(params);
    case 'analyzeCrypto':   return analyzeCrypto(params);
    case 'priceOption':     return priceOption(params);
    case 'evaluateCredit':  return evaluateCredit(params);
    default:
      return { error: 'Unknown action', availableActions: ['analyzeStock','analyzePortfolio','analyzeCrypto','priceOption','evaluateCredit'] };
  }
}

module.exports = { execute, analyzeStock, analyzePortfolio, analyzeCrypto, priceOption, evaluateCredit, STOCK_INDICES, CRYPTO_LIST };
