import { generateAI } from './api';

export interface ParsedStudent {
  name: string;
  rollNumber?: string;
}

const HEADER_WORDS = /^(n°|no|num(é|e)ro|rang|nom|pr(é|e)nom|nom et pr(é|e)nom|(é|e)l(è|e)ves?|classe|liste)$/i;

/**
 * Lecture directe d'une liste simple (un élève par ligne, copiée d'un tableur ou de Pronote),
 * sans appel à l'IA. Renvoie null quand la liste est trop irrégulière : l'IA prend alors le relais.
 */
export const parseStudentListLocally = (text: string): ParsedStudent[] | null => {
  let lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Une seule ligne avec des virgules ou des points-virgules : « Alice Martin, Bruno Leroy, … »
  if (lines.length === 1 && /[;,]/.test(lines[0])) {
    lines = lines[0].split(/[;,]/).map(l => l.trim()).filter(Boolean);
  }
  const result: ParsedStudent[] = [];
  for (const raw of lines) {
    let rollNumber: string | undefined;
    let cells = raw.split(/\t|\s{2,}|\s*;\s*/).map(c => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;
    // Numéro en tête : « 1. », « 01 - », « 3) », ou première colonne numérique
    const lead = cells[0].match(/^(\d{1,3})\s*[\.\)\-:]?\s*(.*)$/);
    if (lead) {
      rollNumber = lead[1];
      cells[0] = lead[2];
      cells = cells.filter(Boolean);
    }
    cells[0] = (cells[0] || '').replace(/^[-•*·▪◦–]+\s*/, '');
    // On garde les colonnes de texte (nom, prénom) et on ignore dates, notes, adresses e-mail…
    const words = cells.filter(c => c && /\p{L}/u.test(c) && !/@|\d{2}[\/.]\d{2}/.test(c));
    const name = words.join(' ').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (HEADER_WORDS.test(name) || words.every(w => HEADER_WORDS.test(w))) continue;
    if (name.length > 60 || /\d/.test(name)) return null;
    result.push({ name, ...(rollNumber ? { rollNumber } : {}) });
  }
  return result.length > 0 ? result : null;
};

export const parseStudentList = async (text: string): Promise<ParsedStudent[]> => {
  const local = parseStudentListLocally(text);
  if (local) return local;

  try {
    const jsonString = (await generateAI(`Analyse la liste brute d'élèves suivante et extrait chaque élève sous forme d'objet structuré.
Pour chaque élève, extrait :
- "name" : Le nom complet de l'élève (conserve fidèlement les prénoms composés, noms de famille, accents et casse).
- "rollNumber" : Le numéro d'appel ou rang éventuel de l'élève s'il est spécifié au début de ligne ou dans une colonne.

Nettoie les puces, tirets, symboles inutiles ou en-têtes de colonnes (comme "Nom", "Prénom", "Numéro", "Élèves").
Voici la liste brute à traiter :

${text}`, {
      systemInstruction: "Tu es un extracteur de données d'élèves pour les enseignants. Tu dois extraire avec rigueur, rapidité et fidélité les noms et numéros des élèves sans inventer d'information.",
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: 'ARRAY',
        description: "Tableau de tous les élèves extraits.",
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: "Nom complet de l'élève." },
            rollNumber: { type: 'STRING', description: "Numéro d'appel ou identifiant de l'élève." },
          },
          required: ['name'],
        },
      },
    })).trim();
    if (!jsonString) {
      throw new Error("Aucune réponse générée par l'IA.");
    }

    const parsedData = JSON.parse(jsonString);

    if (Array.isArray(parsedData) && parsedData.every(item => typeof item === 'object' && item !== null && typeof item.name === 'string')) {
      const validStudents = parsedData
        .map(item => ({
          name: String(item.name).trim(),
          rollNumber: item.rollNumber ? String(item.rollNumber).trim() : undefined,
        }))
        .filter(item => item.name.length > 0);

      if (validStudents.length === 0) {
        throw new Error("Aucun nom d'élève valide n'a pu être extrait du texte fourni.");
      }

      return validStudents;
    } else {
      throw new Error("Le format de réponse de l'IA est invalide.");
    }

  } catch (error) {
    console.error("Erreur lors de l'analyse de la liste par l'IA :", error);
    if (error instanceof Error && error.message) {
      throw new Error(error.message);
    }
    throw new Error("Impossible de traiter la liste d'élèves. Veuillez vérifier le format et réessayer.");
  }
};
