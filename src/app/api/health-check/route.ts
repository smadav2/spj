import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSchema } from "@/db/ensure-schema";

export const dynamic = "force-dynamic";

// Same diagnosis as /api/health but scoped under the app API so the client can
// call it without caching problems in older proxies.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureSchema();
    return Response.json({ ok: true, schema: "ready", configured: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const detail = (error as { cause?: { message?: string } })?.cause?.message || "";
    if (/DATABASE_URL/i.test(`${message} ${detail}`)) {
      return Response.json({ ok: false, configured: false, error: "DATABASE_URL belum tersedia pada runtime Vercel. Tambahkan pada Settings → Environment Variables (Production & Preview), lalu Redeploy." }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    if (/ENOTFOUND|ECONNREFUSED|getaddrinfo|timeout/i.test(`${message} ${detail}`)) {
      return Response.json({ ok: false, configured: true, error: "Host database tidak terjangkau. Periksa connection string, dan pastikan project Neon tidak sedang di-pause." }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    if (/password authentication failed/i.test(`${message} ${detail}`)) {
      return Response.json({ ok: false, configured: true, error: "Password database ditolak. Salin ulang connection string dari dashboard Neon." }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    if (/SSL|sslmode/i.test(`${message} ${detail}`)) {
      return Response.json({ ok: false, configured: true, error: "Koneksi memerlukan SSL. Tambahkan ?sslmode=require pada akhir DATABASE_URL." }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: false, configured: true, error: `Database terhubung tetapi tabel gagal disiapkan: ${message || "kesalahan tidak dikenal"}` }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
