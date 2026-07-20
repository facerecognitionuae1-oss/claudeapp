require('dotenv').config();
const path = require('path');

const root = path.join(__dirname, '..');
const persistentRoot = process.env.PERSISTENT_DIR ? path.resolve(process.env.PERSISTENT_DIR) : root;

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: process.env.TRUST_PROXY === 'true',
  authCookie: process.env.AUTH_COOKIE === 'true',
  allowDemoFallback: process.env.ALLOW_DEMO_FALLBACK === 'true',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@1234',
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: process.env.PGSSL === 'true',
  pgvector: process.env.PGVECTOR_ENABLED === 'true',
  knowledge: {
    embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1536', 10),
  },
  uploadDir: path.resolve(persistentRoot, process.env.UPLOAD_DIR || './data/uploads'),
  generatedDir: path.resolve(persistentRoot, process.env.GENERATED_DIR || './generated'),
  dataFile: process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(persistentRoot, 'data', 'db.json'),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '25', 10),
  rateLimit: {
    apiWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    apiMax: parseInt(process.env.RATE_LIMIT_API_MAX || '240', 10),
    authWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10),
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '12', 10),
  },
  ocr: {
    enabled: process.env.OCR_ENABLED === 'true',
    command: process.env.OCR_COMMAND || 'tesseract',
    lang: process.env.OCR_LANG || 'eng+ara',
    timeoutMs: parseInt(process.env.OCR_TIMEOUT_MS || '60000', 10),
  },
  skywork: {
    key: process.env.SKYWORK_API_KEY || '',
  },
  manus: {
    key: process.env.MANUS_API_KEY || '',
    profile: process.env.MANUS_AGENT_PROFILE || 'manus-1.6',
  },
  search: {
    tavily: process.env.TAVILY_API_KEY || '',
    brave: process.env.BRAVE_API_KEY || '',
  },
  providers: {
    openai: {
      key: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },
    anthropic: {
      key: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    },
    ollama: {
      enabled: process.env.OLLAMA_ENABLED === 'true',
      url: process.env.OLLAMA_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    },
  },
};
