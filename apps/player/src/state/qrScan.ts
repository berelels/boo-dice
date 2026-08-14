import { Capacitor } from '@capacitor/core';
import { isNative } from '../db/open.js';

export interface SessionQrPayload {
  readonly host: string;
  readonly port: number;
  readonly code: string;
}

/** Estágio do scan, para a tela mostrar um texto diferente em cada um. */
export type QrScanStage = 'permission' | 'installing-module' | 'scanning';

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
 * os três casos como "não rolou, tente os campos manuais". Lança erro só se o
 * módulo do Google Barcode Scanner não conseguir ser baixado (ver abaixo).
 */
export async function scanSessionQr(
  onStage?: (stage: QrScanStage) => void,
): Promise<SessionQrPayload | null> {
  const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');

  onStage?.('permission');
  const current = await BarcodeScanner.checkPermissions();
  const granted =
    current.camera === 'granted' || current.camera === 'limited'
      ? current.camera
      : (await BarcodeScanner.requestPermissions()).camera;
  if (granted !== 'granted' && granted !== 'limited') return null;

  // No Android, `scan()` depende do módulo Google Barcode Scanner, baixado
  // sob demanda pelo Google Play Services — não vem junto do APK. Na
  // primeira vez que o app pede pra escanear, o módulo ainda não está
  // instalado, e sem baixá-lo explicitamente `scan()` não abre câmera
  // nenhuma e não lança erro: o botão só volta ao normal como se nada
  // tivesse acontecido, e clicar de novo repete o mesmo silêncio.
  if (Capacitor.getPlatform() === 'android') {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      onStage?.('installing-module');
      await installGoogleBarcodeScannerModule(BarcodeScanner);
    }
  }

  onStage?.('scanning');
  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
  const raw = barcodes[0]?.rawValue;
  if (!raw) return null;

  return parseSessionQr(raw);
}

async function installGoogleBarcodeScannerModule(
  BarcodeScanner: Awaited<
    typeof import('@capacitor-mlkit/barcode-scanning')
  >['BarcodeScanner'],
): Promise<void> {
  const { GoogleBarcodeScannerModuleInstallState } = await import(
    '@capacitor-mlkit/barcode-scanning'
  );

  await new Promise<void>((resolve, reject) => {
    let handle: { remove(): Promise<void> } | undefined;
    void BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (event) => {
      if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) {
        void handle?.remove();
        resolve();
      } else if (
        event.state === GoogleBarcodeScannerModuleInstallState.FAILED ||
        event.state === GoogleBarcodeScannerModuleInstallState.CANCELED
      ) {
        void handle?.remove();
        reject(new Error('Não consegui baixar o leitor de QR. Tente de novo.'));
      }
    }).then((registered) => {
      handle = registered;
    });
    void BarcodeScanner.installGoogleBarcodeScannerModule();
  });
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
