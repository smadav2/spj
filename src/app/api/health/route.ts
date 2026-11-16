import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSchema } from "@/db/ensure-schema";
import { MISSING_DATABASE_URL } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureSchema();
    return Response.json({ ok: true, schema: "ready" });
  } catch (error) {
    console.error("Health check failed", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("DATABASE_URL")) return Response.json({ ok: false, configured: false, error: MISSING_DATABASE_URL }, { status: 500 });
    return Response.json({ ok: false, error: "Database tidak dapat diakses atau tabel tidak dapat dibuat. Periksa DATABASE_URL (gunakan endpoint pooled dan ?sslmode=require)." }, { status: 500 });
  }
}
