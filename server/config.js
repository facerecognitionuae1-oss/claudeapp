require('dotenv').config();
const path = require('path');

const root = path.join(__dirname, '..');

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@1234',
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: process.env.PGSSL === 'true',
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './data/uploads'),
  generatedDir: path.resolve(root, process.env.GENERATED_DIR || './generated'),
  dataFile: path.join(root, 'data', 'db.json'),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '25', 10),
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
