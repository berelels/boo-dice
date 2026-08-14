import { isNative } from '../db/open.js';

export interface SessionQrPayload {
  readonly host: string;
  readonly port: number;
  readonly code: string;
}

/** Se o leitor de QR faz sentido nesta plataforma — ML Kit é nativo, não roda no navegador. */
export function canScanQr(): boolean {
  return isNative();
}

/**
 * Escaneia o QR da tela de sessão do Mestre e devolve os dados de conexão.
 *
 * O plugin (`@capacitor-mlkit/barcode-scanning`) entra por `import()` dinâmico
 * pelo mesmo motivo do driver nativo em `db/open.ts`: código nativo-only não
 * deve pesar no bundle web, onde `canScanQr()` já impede que esta função seja
 * chamada.
 *
 * Devolve `null` se a permissão de câmera for negada, se o usuário cancelar o
 * scan, ou se o QR lido não for um código de sessão válido — o chamador trata
 * os três casos como "não rolou, tente os campos manuais".
 */
export async function scanSessionQr(): Promise<SessionQrPayload | null> {
  const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');

  const current = await BarcodeScanner.checkPermissions();
  const granted =
    current.camera === 'granted' || current.camera === 'limited'
      ? current.camera
      : (await BarcodeScanner.requestPermissions()).camera;
  if (granted !== 'granted' && granted !== 'limited') return null;

  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
  const raw = barcodes[0]?.rawValue;
  if (!raw) return null;

  return parseSessionQr(raw);
}

function parseSessionQr(raw: string): SessionQrPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'host' in parsed &&
      'port' in parsed &&
      'code' in parsed &&
      typeof parsed.host === 'string' &&
      typeof parsed.port === 'number' &&
      typeof parsed.code === 'string'
    ) {
      return { host: parsed.host, port: parsed.port, code: parsed.code };
    }
  } catch {
    // QR de outra coisa qualquer — não é um erro, só não é o que procuramos.
  }
  return null;
}
