import * as XLSX from 'xlsx';
import { StudentCPSProfile } from '../types';

/**
 * Normalizes student name for fuzzy matching (lowercase, no accents, single spaces)
 */
export const normalizeStudentName = (name: string): string => {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Parses raw AI CPS JSON or Excel/CSV export and extracts student CPS profiles.
 * Supports:
 * - JSON direct export from AI CPS ({ students: [...], evaluations: [...], sociogram: [...] })
 * - Excel/CSV tables with CPS metrics (Score global, Dimension cognitive, émotionnelle, sociale, statut, affinités)
 */
export const parseCPSExport = (
  rawData: string | ArrayBuffer,
  fileName: string
): { profiles: Map<string, StudentCPSProfile>; count: number } => {
  const profiles = new Map<string, StudentCPSProfile>();

  // 1. Try parsing as JSON first
  if (typeof rawData === 'string' || (fileName.endsWith('.json') && typeof rawData === 'string')) {
    try {
      const json = JSON.parse(rawData as string);
      
      // Format 1: Direct array of student CPS objects
      const items = Array.isArray(json)
        ? json
        : Array.isArray(json.students)
        ? json.students
        : Array.isArray(json.results)
        ? json.results
        : Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.evaluations)
        ? json.evaluations
        : [];

      if (items.length > 0) {
        items.forEach((item: any) => {
          const name = item.name || item.studentName || item.eleve || item.nom || item.student;
          if (!name || typeof name !== 'string') return;

          const profile: StudentCPSProfile = {
            studentName: name.trim(),
            globalScore: parseNumeric(item.globalScore ?? item.score ?? item.cpsScore ?? item.scoreGlobal ?? item.total),
            emotionalScore: parseNumeric(item.emotionalScore ?? item.emotions ?? item.regulationEmotionnelle ?? item.stress),
            socialScore: parseNumeric(item.socialScore ?? item.social ?? item.empathie ?? item.cooperation ?? item.relationnel),
            cognitiveScore: parseNumeric(item.cognitiveScore ?? item.cognitif ?? item.attention ?? item.decision),
            rawCategory: item.category || item.profil || item.role || item.statut || item.categoryName,
            preferredPartners: parseStringList(item.preferredPartners ?? item.affinites ?? item.amis ?? item.choixPositifs),
            avoidPartners: parseStringList(item.avoidPartners ?? item.conflits ?? item.rejets ?? item.choixNegatifs),
            notes: item.notes || item.remarques,
          };

          profiles.set(normalizeStudentName(name), profile);
        });

        if (profiles.size > 0) {
          return { profiles, count: profiles.size };
        }
      }
    } catch {
      // Continue to spreadsheet parsing if JSON parsing fails or isn't array
    }
  }

  // 2. Parse as Excel or CSV
  try {
    let workbook: XLSX.WorkBook;
    if (typeof rawData === 'string') {
      workbook = XLSX.read(rawData, { type: 'string' });
    } else {
      workbook = XLSX.read(rawData, { type: 'array' });
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (rows.length < 2) {
      throw new Error("Le fichier CPS ne contient pas assez de données.");
    }

    const headerRow = (rows[0] || []).map((h: any) => normalizeStudentName(String(h || '')));

    // Find column indexes
    let nameCol = headerRow.findIndex(h => h.includes('nom') || h.includes('eleve') || h.includes('student') || h.includes('prenom'));
    let scoreCol = headerRow.findIndex(h => h.includes('score') || h.includes('global') || h.includes('total') || h.includes('cps'));
    let emotionalCol = headerRow.findIndex(h => h.includes('emotion') || h.includes('stress') || h.includes('affec'));
    let socialCol = headerRow.findIndex(h => h.includes('social') || h.includes('relat') || h.includes('empath') || h.includes('coop'));
    let cognitiveCol = headerRow.findIndex(h => h.includes('cognit') || h.includes('atten') || h.includes('decis'));
    let roleCol = headerRow.findIndex(h => h.includes('statut') || h.includes('role') || h.includes('profil') || h.includes('categ'));
    let preferredCol = headerRow.findIndex(h => h.includes('affinit') || h.includes('positif') || h.includes('ami') || h.includes('pref'));
    let avoidCol = headerRow.findIndex(h => h.includes('evit') || h.includes('negatif') || h.includes('rejet') || h.includes('conflit'));

    if (nameCol === -1) nameCol = 0; // Default to first column

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const nameVal = row[nameCol];
      if (!nameVal) continue;
      const rawName = String(nameVal).trim();
      if (!rawName) continue;

      const profile: StudentCPSProfile = {
        studentName: rawName,
        globalScore: scoreCol !== -1 ? parseNumeric(row[scoreCol]) : undefined,
        emotionalScore: emotionalCol !== -1 ? parseNumeric(row[emotionalCol]) : undefined,
        socialScore: socialCol !== -1 ? parseNumeric(row[socialCol]) : undefined,
        cognitiveScore: cognitiveCol !== -1 ? parseNumeric(row[cognitiveCol]) : undefined,
        rawCategory: roleCol !== -1 && row[roleCol] ? String(row[roleCol]).trim() : undefined,
        preferredPartners: preferredCol !== -1 ? parseStringList(row[preferredCol]) : undefined,
        avoidPartners: avoidCol !== -1 ? parseStringList(row[avoidCol]) : undefined,
      };

      // Fallback: If no score col found, average available numeric columns
      if (profile.globalScore === undefined) {
        const numericValues = row
          .filter((_, idx) => idx !== nameCol)
          .map(val => parseNumeric(val))
          .filter((val): val is number => val !== undefined);
        
        if (numericValues.length > 0) {
          profile.globalScore = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
        }
      }

      profiles.set(normalizeStudentName(rawName), profile);
    }
  } catch (err) {
    console.error("Erreur parsing CPS:", err);
    throw new Error("Impossible d'interpréter le fichier de résultats AI CPS. Formats acceptés : JSON, Excel (.xlsx, .xls) ou CSV.");
  }

  return { profiles, count: profiles.size };
};

const parseNumeric = (val: any): number | undefined => {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') {
    // If score is on a 0-20 scale, scale to 0-100; if 0-5 scale, scale to 0-100
    if (val <= 5 && val >= 0) return (val / 5) * 100;
    if (val <= 20 && val >= 0) return (val / 20) * 100;
    return val;
  }
  const str = String(val).replace(',', '.').replace('%', '').trim();
  const num = parseFloat(str);
  if (isNaN(num)) return undefined;
  if (num <= 5 && num >= 0) return (num / 5) * 100;
  if (num <= 20 && num >= 0) return (num / 20) * 100;
  return num;
};

const parseStringList = (val: any): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).map(s => s.trim()).filter(Boolean);
  const str = String(val);
  return str.split(/[,;\n|]/).map(s => s.trim()).filter(Boolean);
};
