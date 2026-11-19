import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";

const root = path.resolve(process.cwd(), "../..");
const outputDir = path.join(root, "docs", "generados");
fs.mkdirSync(outputDir, { recursive: true });

const pdfPath = path.join(outputDir, "Informe-investigacion-Costa-Rica.pdf");
const pdf = new PDFDocument({ margin: 50 });
pdf.pipe(fs.createWriteStream(pdfPath));
pdf.fontSize(20).text("Informe de investigacion - RRHH Costa Rica", { align: "center" });
pdf.moveDown();
pdf.fontSize(11).text("Empresa ficticia: Conecta Costa Rica S.A.");
pdf.text("Sector: Servicios tecnologicos y consultoria.");
pdf.text("Tamano: 250 colaboradores simulados.");
pdf.moveDown();
pdf.fontSize(14).text("Dominios investigados");
pdf.fontSize(11).text([
  "Vacaciones y feriados",
  "Permisos y licencias",
  "Incapacidades",
  "Jornada y asistencia",
  "Remuneracion",
  "Beneficios",
  "Ingreso y salida",
  "Desempeno y carrera",
  "Conducta y convivencia",
  "Datos y privacidad",
].join("\n"));
pdf.moveDown();
pdf.fontSize(14).text("Fuentes");
pdf.fontSize(11).text("Codigo de Trabajo de Costa Rica; Ministerio de Trabajo y Seguridad Social; Caja Costarricense de Seguro Social.");
pdf.moveDown();
pdf.fontSize(14).text("Criterio interno");
pdf.fontSize(11).text("Las politicas internas adoptadas no pueden quedar por debajo de la legislacion laboral vigente. Se adoptan beneficios superiores cuando la politica empresarial lo requiere.");
pdf.end();

const workbook = XLSX.utils.book_new();
const holidays = [
  ["Fecha", "Feriado", "Tipo"],
  ["2026-01-01", "Ano Nuevo", "nacional"],
  ["2026-04-02", "Jueves Santo", "nacional"],
  ["2026-04-03", "Viernes Santo", "nacional"],
  ["2026-04-11", "Batalla de Rivas", "nacional"],
  ["2026-05-01", "Dia del Trabajo", "nacional"],
  ["2026-07-25", "Anexion de Guanacaste", "nacional"],
  ["2026-08-15", "Dia de la Madre", "nacional"],
  ["2026-09-15", "Dia de la Independencia", "nacional"],
  ["2026-12-25", "Navidad", "nacional"],
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(holidays), "Feriados");
XLSX.writeFile(workbook, path.join(outputDir, "Calendario-rrhh-2026.xlsx"));

console.log(`Generados: ${pdfPath} y ${path.join(outputDir, "Calendario-rrhh-2026.xlsx")}`);
