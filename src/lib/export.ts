import * as XLSX from "xlsx";
import { ScanRow, expiryYear, formatCardNumber } from "./parse";

const HEADER = ["№", "Номер карты", "ИИН", "Срок действия", "Дата сканирования"];

function toRows(rows: ScanRow[]): (string | number)[][] {
  return rows.map((r, i) => [
    i + 1,
    formatCardNumber(r.number),
    r.iin,
    r.expiry,
    new Date(r.scannedAt).toLocaleString("ru-RU"),
  ]);
}

/** Группировка по году срока действия, годы по возрастанию */
export function groupByYear(rows: ScanRow[]): [string, ScanRow[]][] {
  const map = new Map<string, ScanRow[]>();
  for (const r of rows) {
    const y = expiryYear(r.expiry);
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(r);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Excel: один лист на каждый год срока действия */
export function downloadXlsx(rows: ScanRow[]) {
  const wb = XLSX.utils.book_new();
  for (const [year, list] of groupByYear(rows)) {
    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...toRows(list)]);
    ws["!cols"] = [{ wch: 5 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, year.slice(0, 31));
  }
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `cards_${stamp()}.xlsx`,
  );
}

/** CSV одной таблицы (года), разделитель ";" для Excel */
export function downloadCsv(rows: ScanRow[], year: string) {
  const lines = [HEADER, ...toRows(rows)].map((r) =>
    r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(";"),
  );
  const csv = "﻿" + lines.join("\r\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `cards_${year}_${stamp()}.csv`);
}
