require('dotenv').config();
const path = require('path');

const root = path.join(__dirname, '..');
const persistentRoot = process.env.PERSISTENT_DIR ? path.resolve(process.env.PERSISTENT_DIR) : root;

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@1234',
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: process.env.PGSSL === 'true',
  uploadDir: path.resolve(persistentRoot, process.env.UPLOAD_DIR || './data/uploads'),
  generatedDir: path.resolve(persistentRoot, process.env.GENERATED_DIR || './generated'),
  dataFile: process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(persistentRoot, 'data', 'db.json'),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '25', 10),
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
