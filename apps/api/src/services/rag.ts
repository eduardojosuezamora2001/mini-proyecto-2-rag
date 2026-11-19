import { pool } from "../db.js";
import { embedText } from "./embedding.js";
import { config } from "../config.js";
import { completeText } from "./llm.js";

export type Citation = {
  documento: string;
  seccion: string | null;
  enlace: string | null;
};

function normalizeText(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function findHolidayByDate(question: string): Promise<{
  answer: string;
  citations: Citation[];
  resolved: boolean;
  fragments: number;
} | null> {
  const normalizedQuestion = normalizeText(question);
  if (!/\b(feriad|festiv|trabajar|laborar|descans|pago|dia libre)\b/.test(normalizedQuestion)) return null;

  const match = normalizedQuestion.match(
    /\b(\d{1,2})\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)\b(?:\s*(?:de\s*)?(20\d{2}))?/,
  );
  if (!match || (match[3] && match[3] !== "2026")) return null;

  const day = Number(match[1]);
  const month = match[2] === "septiembre" ? "setiembre" : match[2];
  const result = await pool.query(
    `SELECT file_name,section,web_view_link,text
     FROM documentos_vectoriales
     WHERE file_name ILIKE '01-vacaciones-y-feriados%' AND text ILIKE $1
     ORDER BY chunk_index
     LIMIT 1`,
    [`%${day} de ${month}%`],
  );
  const source = result.rows[0];
  if (!source) return null;

  const holidayRow = String(source.text)
    .split(/\r?\n/)
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean))
    .find((cells) => cells.length >= 4 && normalizeText(cells[0]) === `${day} de ${month}`);
  if (!holidayRow) return null;

  const [date, weekday, celebration, payment] = holidayRow;
  const paymentType = normalizeText(payment).includes("no obligatorio")
    ? "de pago no obligatorio"
    : "de pago obligatorio";

  return {
    answer: normalizeText(question).includes("trabajar") || normalizeText(question).includes("laborar")
      ? `En principio no estás obligado a trabajar ese día: el ${date} cae ${weekday.toLowerCase()} y es el feriado por ${celebration}, ${paymentType}. RRHH debe revisar excepciones legales y el pago según tu modalidad. [1]`
      : `Sí. En el calendario 2026, el ${date} cae ${weekday.toLowerCase()} y se conmemora ${celebration}; es un feriado ${paymentType}. “Pago no obligatorio” describe su clasificación salarial, no significa que no sea feriado. [1]`,
    citations: [{
      documento: source.file_name,
      seccion: "Feriados de Costa Rica: calendario 2026",
      enlace: source.web_view_link,
    }],
    resolved: true,
    fragments: 1,
  };
}

async function findHolidayList(question: string): Promise<{
  answer: string;
  citations: Citation[];
  resolved: boolean;
  fragments: number;
} | null> {
  const normalizedQuestion = normalizeText(question);
  const asksList =
    /\b(feriados?|dias?\s+libres?|dias?\s+festiv[os]*|calendario)\b/.test(normalizedQuestion) &&
    /\b(cuales?|lista|dame|todos|obligatori[os]*|no\s+obligatori[os]*)\b/.test(normalizedQuestion);
  if (!asksList) return null;

  const wantsOptional = /\bno\s+obligatori[os]*\b/.test(normalizedQuestion);
  const result = await pool.query(
    `SELECT file_name,section,web_view_link,text
     FROM documentos_vectoriales
     WHERE file_name ILIKE '01-vacaciones-y-feriados%'`,
  );
  if (result.rows.length === 0) return null;

  const source = result.rows.find((row) => String(row.text).includes("|")) ?? result.rows[0];
  const holidays = String(source.text)
    .split(/\r?\n/)
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 4 && /^\d{1,2} de /.test(cells[0]));

  const filtered = holidays.filter((cells) =>
    wantsOptional
      ? normalizeText(cells[3]).includes("no obligatorio")
      : normalizeText(cells[3]).includes("obligatorio") &&
        !normalizeText(cells[3]).includes("no obligatorio"),
  );
  if (filtered.length === 0) return null;

  const label = wantsOptional ? "de pago no obligatorio" : "de pago obligatorio";
  const items = filtered.map((cells) => `${cells[0]} — ${cells[2]}`).join("; ");
  return {
    answer: `Los feriados ${label} del calendario 2026 son: ${items}. [1]`,
    citations: [{
      documento: source.file_name,
      seccion: "Feriados de Costa Rica: calendario 2026",
      enlace: source.web_view_link,
    }],
    resolved: true,
    fragments: 1,
  };
}

export async function searchPolicy(question: string): Promise<{
  answer: string;
  citations: Citation[];
  resolved: boolean;
  fragments: number;
}> {
  const holidayList = await findHolidayList(question);
  if (holidayList) return holidayList;

  const holiday = await findHolidayByDate(question);
  if (holiday) return holiday;

  const embedding = await embedText(question);
  const result = await pool.query(
    `SELECT id,file_name,section,web_view_link,text,
            1 - (embedding <=> $1::vector) AS similarity
     FROM documentos_vectoriales
     WHERE 1 - (embedding <=> $1::vector) >= $2
     ORDER BY embedding <=> $1::vector
     LIMIT 5`,
    [`[${embedding.join(",")}]`, config.ragThreshold],
  );

  if (result.rows.length === 0) {
    return {
      answer: "No encontré una política que respalde esa consulta en los documentos disponibles. Puedo derivarte a RRHH.",
      citations: [],
      resolved: false,
      fragments: 0,
    };
  }

  const context = result.rows
    .map((row, index) => `[${index + 1}] ${row.file_name} - ${row.section ?? "General"}:\n${row.text}`)
    .join("\n\n");
  const citations = result.rows.map((row) => ({
    documento: row.file_name,
    seccion: row.section,
    enlace: row.web_view_link,
  }));

  const llmAnswer = await completeText(
    "Eres un agente de políticas de RRHH. Responde en español, de forma directa y en un máximo de 120 palabras. Usa solo el contexto. Cita cada dato factual con el número de fuente entre corchetes, por ejemplo [1]. No copies el documento completo ni inventes cifras.",
    `Contexto:\n${context}\n\nPregunta: ${question}\n\nResponde solo con información respaldada por el contexto y usa las referencias numéricas disponibles.`,
  );

  return {
    answer: llmAnswer || result.rows.map((row) => row.text.slice(0, 500)).join("\n\n"),
    citations,
    resolved: true,
    fragments: result.rows.length,
  };
}
