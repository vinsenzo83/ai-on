# AI Orchestrator Engine

멀티모델 AI 오케스트레이션 엔진 — 의도 분석 → 작업 분해 → 역할별 실행 → 결과 통합

## 구조

```
ai-orchestrator/
├── src/
│   ├── server.js                 # Express 서버 (포트 3000)
│   ├── orchestrator/
│   │   ├── intentAnalyzer.js     # 의도 분류기 (9가지 타입)
│   │   ├── masterOrchestrator.js # 마스터 오케스트레이터
│   │   ├── dynamicOrchestrator.js# 동적 파이프라인 실행
│   │   └── comboPipelines.js     # 콤보 파이프라인 정의
│   ├── services/
│   │   └── aiConnector.js        # 멀티 AI 제공자 연결 (OpenAI/Anthropic/Google 등)
│   ├── pipelines/
│   │   └── visionPipeline.js     # Vision 이미지 분석 파이프라인
│   └── types/
│       └── index.js              # 타입/모델 레지스트리
├── package.json
└── .env.example
```

## 핵심 기능

- **의도 분석**: 9가지 작업 타입 자동 분류 (ppt/website/blog/report/code/email/resume/image/unknown)
- **멀티모델 폴백**: OpenAI → Google → Mistral → Anthropic → Moonshot → DeepSeek
- **서킷 브레이커**: 3회 연속 실패 시 60초 차단 후 자동 복구
- **Vision 파이프라인**: 9가지 모드 (OCR/상품분석/UI분석/문서분석 등), URL 차단 시 base64→Anthropic 자동 폴백
- **세션 관리**: JWT 인증, SQLite 세션 저장, 대화 히스토리 유지

## 실행

```bash
cp .env.example .env   # API 키 설정
npm install
npm start              # 포트 3000
```

## 배포 (VPS)

```bash
# VPS: /opt/ai-orchestrator/app/ai-orchestrator
git pull origin genspark_ai_developer
pm2 restart ai-orchestrator
curl http://localhost:3000/health
```

## API

| 엔드포인트 | 설명 |
|---|---|
| `POST /api/auth/login` | JWT 로그인 |
| `POST /api/sessions` | 세션 생성 |
| `POST /api/message` | AI 메시지 처리 (의도분석→실행→응답) |
| `POST /api/pipelines/vision` | 이미지 분석 |
| `GET /api/models` | 사용 가능 모델 목록 |
| `GET /health` | 헬스체크 |
