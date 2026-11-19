import fs from "node:fs";
import { google } from "googleapis";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";
import { config } from "../config.js";

const driveFileFields = "id,name,mimeType,modifiedTime,webViewLink,parents,trashed,size";

export type DriveDocument = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
  size: string | null;
};

type DriveFile = DriveDocument & {
  parents?: string[] | null;
  trashed?: boolean | null;
};

function getCredentials() {
  if (config.serviceAccountJson) {
    const resolved = fs.existsSync(config.serviceAccountJson)
      ? JSON.parse(fs.readFileSync(config.serviceAccountJson, "utf8"))
      : undefined;
    if (resolved) return resolved;
  }
  if (config.serviceAccountEmail && config.serviceAccountPrivateKey) {
    return {
      client_email: config.serviceAccountEmail,
      private_key: config.serviceAccountPrivateKey,
    };
  }
  return undefined;
}

export function createDriveClient() {
  const credentials = getCredentials();
  if (!credentials) {
    throw new Error(
      "Google Drive no está configurado. Añade GOOGLE_SERVICE_ACCOUNT_JSON o las variables EMAIL/PRIVATE_KEY.",
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

function toDriveDocument(file: DriveFile): DriveDocument {
  if (!file.id || !file.name || !file.mimeType) {
    throw new Error("Google Drive devolvió un documento sin metadatos requeridos.");
  }
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime ?? null,
    webViewLink: file.webViewLink ?? null,
    size: file.size ?? null,
  };
}

export async function listDriveDocuments(): Promise<DriveDocument[]> {
  const drive = createDriveClient();
  const documents: DriveDocument[] = [];
  let pageToken: string | undefined;

  do {
    const result = await drive.files.list({
      q: `'${config.driveFolderId}' in parents and trashed=false`,
      fields: `nextPageToken,files(${driveFileFields})`,
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of result.data.files ?? []) {
      if (file.mimeType === "application/vnd.google-apps.folder") continue;
      documents.push(toDriveDocument(file as DriveFile));
    }
    pageToken = result.data.nextPageToken ?? undefined;
  } while (pageToken);

  return documents;
}

async function getFileInConfiguredFolder(fileId: string) {
  const drive = createDriveClient();
  const result = await drive.files.get({
    fileId,
    fields: driveFileFields,
    supportsAllDrives: true,
  });
  const file = result.data as DriveFile;
  if (
    file.trashed ||
    file.mimeType === "application/vnd.google-apps.folder" ||
    !file.parents?.includes(config.driveFolderId)
  ) {
    return null;
  }
  return { drive, file };
}

export async function getDriveDocument(fileId: string) {
  const result = await getFileInConfiguredFolder(fileId);
  if (!result) return null;

  const { drive, file } = result;
  if (!file.id || !file.name || !file.mimeType) {
    throw new Error("Google Drive devolvió un documento sin metadatos requeridos.");
  }

  let buffer: Buffer;
  if (file.mimeType === "application/vnd.google-apps.document") {
    const exported = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(exported.data as ArrayBuffer);
  } else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const exported = await drive.files.export(
      {
        fileId,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(exported.data as ArrayBuffer);
  } else {
    const downloaded = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(downloaded.data as ArrayBuffer);
  }

  const content = await extractText(
    {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink ?? undefined,
    },
    buffer,
  );
  if (!content.trim()) {
    throw new Error("No hay texto legible para mostrar en este formato.");
  }

  return { ...toDriveDocument(file), content };
}

export async function uploadDriveDocument(name: string, mimeType: string, content: Buffer) {
  const drive = createDriveClient();
  const result = await drive.files.create({
    requestBody: {
      name,
      mimeType,
      parents: [config.driveFolderId],
    },
    media: { mimeType, body: content },
    fields: driveFileFields,
    supportsAllDrives: true,
  });
  return toDriveDocument(result.data as DriveFile);
}

export async function deleteDriveDocument(fileId: string): Promise<boolean> {
  const result = await getFileInConfiguredFolder(fileId);
  if (!result) return false;
  await result.drive.files.delete({ fileId, supportsAllDrives: true });
  return true;
}

export async function extractText(file: {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}, buffer: Buffer): Promise<string> {
  if (file.mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return (await pdfParse(buffer)).text;
  }
  if (
    file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    return (await mammoth.extractRawText({ buffer })).value;
  }
  if (
    file.mimeType.includes("spreadsheet") ||
    [".xlsx", ".xls", ".csv"].some((extension) => file.name.toLowerCase().endsWith(extension))
  ) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames
      .map((sheetName) => `${sheetName}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`)
      .join("\n\n");
  }
  if (file.mimeType === "application/vnd.google-apps.document") {
    return buffer.toString("utf8");
  }
  if (
    file.mimeType === "text/plain" ||
    file.mimeType === "text/csv" ||
    file.mimeType === "text/markdown" ||
    file.name.toLowerCase().endsWith(".md")
  ) {
    return buffer.toString("utf8");
  }
  return "";
}
