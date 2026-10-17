/**
 * Utilidades de fecha y zona horaria para El Salvador (America/El_Salvador / UTC-6)
 */

export function getElSalvadorDateString(date: Date = new Date()): string {
  // Retorna la fecha en formato YYYY-MM-DD según la zona horaria America/El_Salvador
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function getElSalvadorNow(): Date {
  const now = new Date();
  const elSalvadorTimeStr = now.toLocaleString('en-US', { timeZone: 'America/El_Salvador' });
  return new Date(elSalvadorTimeStr);
}
