FROM node:20-alpine

# 작업 디렉토리
WORKDIR /app

# 의존성 먼저 설치 (캐시 최적화)
COPY package*.json ./
RUN npm ci --only=production

# 소스 복사
COPY src/ ./src/
COPY public/ ./public/

# 데이터/로그 디렉토리 생성
RUN mkdir -p data logs

# 비루트 사용자로 실행 (보안)
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

# 포트 노출
EXPOSE 3000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# 시작 명령
CMD ["node", "src/server.js"]
