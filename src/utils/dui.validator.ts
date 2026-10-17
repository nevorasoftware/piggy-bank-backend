/**
 * Validador oficial del Documento Único de Identidad (DUI) de El Salvador.
 * Formato requerido: 00000000-0 (8 dígitos, guion, 1 dígito verificador).
 */

export interface DuiValidationResult {
  isValid: boolean;
  message?: string;
}

export function validateDUI(dui: string): DuiValidationResult {
  if (!dui || typeof dui !== 'string') {
    return { isValid: false, message: 'El DUI es requerido' };
  }

  const cleanDui = dui.trim();
  const duiRegex = /^\d{8}-\d{1}$/;

  if (!duiRegex.test(cleanDui)) {
    return {
      isValid: false,
      message: 'Formato inválido. Debe tener el formato 00000000-0 (8 dígitos, guion y dígito verificador)',
    };
  }

  const [digitsPart, verifierPart] = cleanDui.split('-');
  const digits = digitsPart.split('').map(Number);
  const checkDigit = parseInt(verifierPart, 10);

  // Algoritmo oficial de dígito verificador:
  // Ponderaciones: 9, 8, 7, 6, 5, 4, 3, 2
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += digits[i] * (9 - i);
  }

  const mod = sum % 10;
  const computedCheckDigit = (10 - mod) % 10;

  if (computedCheckDigit !== checkDigit) {
    return {
      isValid: false,
      message: `El dígito verificador (${checkDigit}) no es válido para este DUI.`,
    };
  }

  return { isValid: true };
}
