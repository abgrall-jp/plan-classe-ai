
import { apiEnseignant } from './api';

export interface ParsedStudent {
  name: string;
  rollNumber?: string;
}

// L'analyse est faite par le serveur, qui garde la clé Gemini.
export const parseStudentList = async (text: string): Promise<ParsedStudent[]> => {
  try {
    const response = await apiEnseignant<{ text: string }>('POST', '/api/gemini/students', { text });

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
