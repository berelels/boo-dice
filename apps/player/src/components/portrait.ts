/**
 * Retrato do personagem.
 *
 * A foto vira um data URL guardado dentro da própria ficha, o que a mantém
 * autocontida: exportar ou sincronizar o personagem leva o rosto junto, sem
 * arquivos soltos para gerenciar.
 *
 * Por isso o redimensionamento não é opcional. Uma foto de celular tem vários
 * megabytes; enfiada em base64 dentro de um JSON que é gravado a cada edição,
 * ela deixaria a ficha lenta e encheria o armazenamento. 512 px é bem mais do
 * que o maior lugar onde o retrato aparece.
 */

const MAX_DIMENSION = 512;
const JPEG_QUALITY = 0.82;

export async function pickPortrait(): Promise<string | null> {
  const file = await chooseFile();
  if (!file) return null;
  return resizeToDataUrl(file);
}

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    // `cancel` não é suportado em todo lugar; onde não for, a Promise
    // simplesmente não resolve e o fluxo termina sem efeito nenhum.
    input.addEventListener('cancel', () => resolve(null), { once: true });

    input.click();
  });
}

export async function resizeToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  // Recorte quadrado central: o retrato é sempre exibido em círculo, e cortar
  // no centro é o que preserva o rosto na esmagadora maioria das fotos.
  const side = Math.min(bitmap.width, bitmap.height);
  const sourceX = (bitmap.width - side) / 2;
  const sourceY = (bitmap.height - side) / 2;
  const target = Math.min(side, MAX_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não consegui preparar a imagem.');

  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, target, target);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}
