require('dotenv').config();
const path = require('path');

const root = path.join(__dirname, '..');
const persistentDir = process.env.PERSISTENT_DIR
  ? path.resolve(process.env.PERSISTENT_DIR)
  : path.join(root, 'data');

function resolveRuntimePath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@1234',
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: process.env.PGSSL === 'true',
  persistentDir,
  uploadDir: resolveRuntimePath(process.env.UPLOAD_DIR, path.join(persistentDir, 'uploads')),
  generatedDir: resolveRuntimePath(process.env.GENERATED_DIR, path.join(persistentDir, 'generated')),
  dataFile: resolveRuntimePath(process.env.DATA_FILE, path.join(persistentDir, 'db.json')),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '25', 10),
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
      url: process.env.OLLAMA_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    },
  },
};
