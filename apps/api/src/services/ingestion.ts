import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../db.js";
import { config } from "../config.js";
import { createDriveClient, extractText } from "./drive.js";
import { embedText } from "./embedding.js";

function chunkText(text: string, wordsPerChunk = 750): Array<{ text: string; section: string | null }> {
  const paragraphs = text.replace(/\r/g, "").split(/\n{2,}/);
  const chunks: Array<{ text: string; section: string | null }> = [];
  let current = "";
  let section: string | null = null;

  for (const paragraph of paragraphs) {
    const heading = paragraph.match(/^#{0,6}\s*(.+)$/m);
    if (heading) section = heading[1].trim();
    if ((current + " " + paragraph).split(/\s+/).length > wordsPerChunk && current) {
      chunks.push({ text: current.trim(), section });
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current.trim()) chunks.push({ text: current.trim(), section });
  return chunks;
}

export async function syncDrive() {
  const drive = createDriveClient();
  const folderId = config.driveFolderId;
  const listed = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    pageSize: 100,
  });
  const files = listed.data.files ?? [];
  const activeIds = new Set<string>();
  let indexed = 0;
  let updated = 0;

  for (const file of files) {
    if (!file.id || !file.name) continue;
    activeIds.add(file.id);

    let buffer: Buffer;
    if (file.mimeType === "application/vnd.google-apps.document") {
      const exported = await drive.files.export(
        { fileId: file.id, mimeType: "text/plain" },
        { responseType: "arraybuffer" },
      );
      buffer = Buffer.from(exported.data as ArrayBuffer);
    } else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
      const exported = await drive.files.export(
        { fileId: file.id, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        { responseType: "arraybuffer" },
      );
      buffer = Buffer.from(exported.data as ArrayBuffer);
    } else {
      const downloaded = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "arraybuffer" },
      );
      buffer = Buffer.from(downloaded.data as ArrayBuffer);
    }

    const text = await extractText(
      {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType ?? "",
        webViewLink: file.webViewLink ?? undefined,
      },
      buffer,
    );
    if (!text.trim()) continue;

    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const existing = await pool.query(
      "SELECT content_hash FROM documentos_vectoriales WHERE drive_file_id=$1 LIMIT 1",
      [file.id],
    );
    if (existing.rows[0]?.content_hash === hash) continue;

    await pool.query("DELETE FROM documentos_vectoriales WHERE drive_file_id=$1", [file.id]);
    const chunks = chunkText(text);
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const embedding = await embedText(chunk.text);
      await pool.query(
        `INSERT INTO documentos_vectoriales
          (drive_file_id,file_name,section,version,effective_date,responsible,
           web_view_link,modified_time,content_hash,chunk_index,text,embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)`,
        [
          file.id,
          file.name,
          chunk.section,
          null,
          null,
          "RRHH",
          file.webViewLink ?? null,
          file.modifiedTime ? new Date(file.modifiedTime) : null,
          hash,
          chunkIndex,
          chunk.text,
          `[${embedding.join(",")}]`,
        ],
      );
      updated += 1;
    }
    indexed += 1;
  }

  const stored = await pool.query("SELECT DISTINCT drive_file_id FROM documentos_vectoriales");
  for (const row of stored.rows) {
    if (!activeIds.has(row.drive_file_id)) {
      await pool.query("DELETE FROM documentos_vectoriales WHERE drive_file_id=$1", [row.drive_file_id]);
    }
  }

  return { files: files.length, indexed, updated, folderId };
}

export async function syncLocalPolicies() {
  const policyDir = path.join(config.rootDir, "docs", "politicas");
  if (!fs.existsSync(policyDir)) return { indexed: 0, updated: 0, source: "local" };

  let indexed = 0;
  let updated = 0;
  const files = fs.readdirSync(policyDir).filter((name) => name.toLowerCase().endsWith(".md"));
  for (const name of files) {
    const text = fs.readFileSync(path.join(policyDir, name), "utf8");
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const driveFileId = `local:${name}`;
    const existing = await pool.query(
      "SELECT content_hash FROM documentos_vectoriales WHERE drive_file_id=$1 LIMIT 1",
      [driveFileId],
    );
    if (existing.rows[0]?.content_hash === hash) continue;

    await pool.query("DELETE FROM documentos_vectoriales WHERE drive_file_id=$1", [driveFileId]);
    const chunks = chunkText(text);
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const embedding = await embedText(chunk.text);
      await pool.query(
        `INSERT INTO documentos_vectoriales
          (drive_file_id,file_name,section,version,effective_date,responsible,
           web_view_link,modified_time,content_hash,chunk_index,text,embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)`,
        [
          driveFileId,
          name,
          chunk.section,
          "1.0",
          "2026-01-01",
          "RRHH",
          null,
          new Date(),
          hash,
          chunkIndex,
          chunk.text,
          `[${embedding.join(",")}]`,
        ],
      );
      updated += 1;
    }
    indexed += 1;
  }
  return { indexed, updated, source: "local" };
}
