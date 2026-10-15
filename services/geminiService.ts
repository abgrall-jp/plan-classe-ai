
import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = (): string => {
  return process.env.GEMINI_API_KEY || process.env.API_KEY || "";
};

export interface ParsedStudent {
  name: string;
  rollNumber?: string;
}

export const parseStudentList = async (text: string): Promise<ParsedStudent[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Clé d'API Gemini manquante. Veuillez vérifier la configuration de l'application.");
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: `Analyse la liste brute d'élèves suivante et extrait chaque élève sous forme d'objet structuré.
Pour chaque élève, extrait :
- "name" : Le nom complet de l'élève (conserve fidèlement les prénoms composés, noms de famille, accents et casse).
- "rollNumber" : Le numéro d'appel ou rang éventuel de l'élève s'il est spécifié au début de ligne ou dans une colonne.

Nettoie les puces, tirets, symboles inutiles ou en-têtes de colonnes (comme "Nom", "Prénom", "Numéro", "Élèves").
Voici la liste brute à traiter :

${text}`,
      config: {
        systemInstruction: "Tu es un extracteur de données d'élèves pour les enseignants. Tu dois extraire avec rigueur, rapidité et fidélité les noms et numéros des élèves sans inventer d'information.",
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          description: "Tableau de tous les élèves extraits.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: "Nom complet de l'élève.",
              },
              rollNumber: {
                type: Type.STRING,
                description: "Numéro d'appel ou identifiant de l'élève.",
              },
            },
            required: ['name'],
          },
        },
      },
    });

    const jsonString = response.text ? response.text.trim() : "";
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
      throw new Error("Le format de réponse de l'API est invalide.");
    }

  } catch (error) {
    console.error("Erreur lors de l'appel à l'API Gemini 3.7 Flash:", error);
    if (error instanceof Error && error.message) {
      throw new Error(`Erreur lors de l'analyse : ${error.message}`);
    }
    throw new Error("Impossible de traiter la liste d'élèves. Veuillez vérifier le format et réessayer.");
  }
};
