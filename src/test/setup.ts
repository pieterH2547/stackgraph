import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Each test file gets a throwaway SQLite file, and no test ever touches the
 * network or a mail provider.
 */
const dir = mkdtempSync(join(tmpdir(), "whouseswhat-test-"));

process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
process.env.DISABLE_SITE_DETECTION = "1";
delete process.env.RESEND_API_KEY;
