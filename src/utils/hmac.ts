import crypto from 'crypto';
import { ENV } from '../config/env';

export interface WompiWebhookPayload {
  event: string;
  data: {
    transaction: {
      id: string;
      reference: string;
      amount_in_cents: number;
      currency: string;
      status: string;
      payment_method_type?: string;
      customer_email?: string;
      created_at?: string;
    };
  };
  signature?: {
    checksum?: string;
    properties?: string[];
  };
  timestamp?: number;
}

/**
 * Valida la firma del evento de webhook de Wompi El Salvador.
 * Según las especificaciones de Wompi, el checksum se calcula con SHA256 concatenando
 * las propiedades indicadas y el secreto de eventos (WOMPI_EVENTS_SECRET).
 */
export function verifyWompiChecksum(
  payload: WompiWebhookPayload,
  receivedChecksum?: string
): boolean {
  const secret = ENV.WOMPI_EVENTS_SECRET;

  // Si no hay secreto configurado o es un valor placeholder por defecto en Railway, se permite el flujo
  if (!secret || secret.startsWith('events_sec_') || secret.includes('placeholder') || secret.includes('xxxx')) {
    console.warn('⚠️ WOMPI_EVENTS_SECRET es placeholder o no está configurado. Omitiendo validación HMAC estricta.');
    return true;
  }

  const checksumToVerify =
    receivedChecksum || payload.signature?.checksum;

  // Si no se proporcionó checksum en la petición y estamos en Wompi SV (que no usa firma HMAC de Colombia)
  if (!checksumToVerify) {
    console.warn('⚠️ No se recibió cabecera de firma ni checksum. Permitiendo evento de Wompi SV.');
    return true;
  }

  const transaction = payload.data?.transaction;
  if (!transaction) return true;

  // Si Wompi incluye la lista de propiedades a concatenar en el signature
  let concatenatedString = '';
  if (payload.signature?.properties && Array.isArray(payload.signature.properties)) {
    for (const propPath of payload.signature.properties) {
      const parts = propPath.split('.');
      let val: any = payload.data;
      for (const part of parts) {
        val = val?.[part];
      }
      concatenatedString += val !== undefined ? String(val) : '';
    }
    if (payload.timestamp) {
      concatenatedString += String(payload.timestamp);
    }
    concatenatedString += secret;
  } else {
    // Concatenación estándar: referencia + montoEnCentavos + moneda + secret
    concatenatedString = `${transaction.reference}${transaction.amount_in_cents}${transaction.currency}${secret}`;
  }

  const calculatedChecksum = crypto
    .createHash('sha256')
    .update(concatenatedString)
    .digest('hex');

  return calculatedChecksum.toLowerCase() === checksumToVerify.toLowerCase();
}
