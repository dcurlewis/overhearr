import { z } from 'zod';

const DEV_SESSION_SECRET = 'overhearr-dev-session-secret-change-me-in-production';
const DEV_ENCRYPTION_KEY = '00'.repeat(32); // 64 hex chars

const NODE_ENV = (process.env.NODE_ENV ?? 'development') as
  | 'development'
  | 'test'
  | 'production';
const isProd = NODE_ENV === 'production';

// Normalize an empty or whitespace-only secret env var to `undefined` so
// zod's default kicks in (dev/test) or the `required` error message fires
// (production). Without this, blank values evaluate as defined empty strings
// and produce confusing min-length errors.
function clearIfBlank(name: string): void {
  const v = process.env[name];
  if (typeof v === 'string' && v.trim() === '') delete process.env[name];
}
clearIfBlank('SESSION_SECRET');
clearIfBlank('ENCRYPTION_KEY');

const HEX_64 = /^[0-9a-fA-F]{64}$/;

// Build the schema. We default the dev/test values lazily so production stays strict.
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().default(5056),

  HOST: z.string().min(1).default('0.0.0.0'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default(NODE_ENV === 'development' ? 'debug' : 'info'),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('file:'), {
      message: "DATABASE_URL must start with 'file:' (SQLite)",
    })
    .default('file:../config/db/overhearr.db'),

  // Root directory for the on-disk image-proxy cache. In Docker this lives
  // under the bind-mounted /config volume (mirrors how the SQLite DB lives
  // under /config); a local dev checkout writes to `.cache/images` relative
  // to CWD so we never need write access outside the repo.
  IMAGE_CACHE_DIR: z
    .string()
    .min(1)
    .default(NODE_ENV === 'production' ? '/config/cache/images' : '.cache/images'),

  // Soft byte cap for the image cache. Once the on-disk total exceeds this,
  // LRU eviction (oldest access time first) trims it back. Default 512 MiB.
  IMAGE_CACHE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(512 * 1024 * 1024),

  TRUST_PROXY: z
    .union([z.boolean(), z.string()])
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    })
    .default(false),

  // Secrets — different rules for prod vs dev/test
  SESSION_SECRET: isProd
    ? z
        .string({ required_error: 'SESSION_SECRET is required in production' })
        .min(32, 'SESSION_SECRET must be at least 32 characters')
        .refine((v) => v !== DEV_SESSION_SECRET, {
          message: 'SESSION_SECRET must not equal the development default in production',
        })
    : z.string().min(32).default(DEV_SESSION_SECRET),

  ENCRYPTION_KEY: isProd
    ? z
        .string({ required_error: 'ENCRYPTION_KEY is required in production' })
        .regex(HEX_64, 'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
        .refine((v) => v.toLowerCase() !== DEV_ENCRYPTION_KEY, {
          message: 'ENCRYPTION_KEY must not equal the development default in production',
        })
    : z.string().regex(HEX_64).default(DEV_ENCRYPTION_KEY),
});

export type Env = z.infer<typeof baseSchema>;

function loadEnv(): Env {
  const parsed = baseSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nFix the values above (see .env.example) and try again.`
    );
  }
  return parsed.data;
}

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    // Validation errors are user-facing config problems — print cleanly and
    // exit 1 instead of dumping a stack trace at module load time.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n${msg}\n\n`);
    process.exit(1);
  }
}

export const env: Env = loadEnvOrExit();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

// Loud warnings about insecure defaults — emitted directly to stderr to avoid
// circular dependency with the logger module (which depends on env).
if (!isProduction) {
  if (env.SESSION_SECRET === DEV_SESSION_SECRET) {
    process.stderr.write(
      '[env] WARNING: using the development default SESSION_SECRET. ' +
        'Set SESSION_SECRET in your .env before deploying to production.\n'
    );
  }
  if (env.ENCRYPTION_KEY.toLowerCase() === DEV_ENCRYPTION_KEY) {
    process.stderr.write(
      '[env] WARNING: using the development default ENCRYPTION_KEY. ' +
        "Generate one with `openssl rand -hex 32` before deploying to production.\n"
    );
  }
}
