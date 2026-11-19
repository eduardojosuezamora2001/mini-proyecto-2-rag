import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "../../..");

dotenv.config({ path: path.join(rootDir, ".env") });

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? "development-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? "1TyDNmNDUcPtUeuhvDwLE5tk75bSbVSel",
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? path.resolve(rootDir, process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined,
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  serviceAccountPrivateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  geminiApiKey: process.env.GEMINI_API_KEY,
  ragThreshold: Number(process.env.RAG_SIMILARITY_THRESHOLD ?? 0.35),
  rootDir,
};
