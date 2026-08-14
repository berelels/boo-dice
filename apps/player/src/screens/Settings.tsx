import { useRef, useState } from 'react';
import type { Character } from '@dfo/core';
import { Button, Card, Screen, Section, Tappable, TopBar } from '@dfo/ui';
import { isNative } from '../db/open.js';
import { useAppData } from '../db/provider.js';
import {
  BACKUP_REMINDER_DAYS,
  daysSince,
  exportBackup,
  getLastBackupAt,
  importBackupFile,
} from '../state/backup.js';

/**
 * Ajustes — hoje é só a seção de backup, mas fica separada da Galeria porque
 * é claramente "configuração do app", não "personagem". Um lugar óbvio para
 * crescer depois, sem forçar a Galeria a virar um cesto de tudo.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const { characters } = useAppData();
  const [lastBackupAt, setLastBackupAtState] = useState<string | null>(() => getLastBackupAt());
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const runExport = async (): Promise<void> => {
    setBusy('export');
    setMessage(null);
    try {
      const summaries = await characters.list();
      const full = await Promise.all(summaries.map((summary) => characters.get(summary.id)));
      const list = full.filter((character): character is Character => character !== null);

      if (list.length === 0) {
        setMessage({ tone: 'error', text: 'Nenhum personagem para incluir no backup ainda.' });
        return;
      }

      await exportBackup(list);
      setLastBackupAtState(getLastBackupAt());
      setMessage({
        tone: 'success',
        text: `Backup de ${list.length} ${list.length === 1 ? 'ficha salva' : 'fichas salvas'}.`,
      });
    } catch {
      setMessage({ tone: 'error', text: 'Não consegui salvar o backup. Tenta de novo?' });
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (file: File): Promise<void> => {
    setBusy('import');
    setMessage(null);
    try {
      const result = await importBackupFile(file);
      if ('error' in result) {
        setMessage({ tone: 'error', text: result.error });
        return;
      }

      for (const character of result.characters) {
        await characters.save(character);
      }

      const skippedText =
        result.skipped > 0
          ? ` (${result.skipped} ${result.skipped === 1 ? 'ficha ignorada' : 'fichas ignoradas'} por estar corrompida)`
          : '';

      setMessage(
        result.characters.length > 0
          ? {
              tone: 'success',
              text: `${result.characters.length} ${result.characters.length === 1 ? 'ficha restaurada' : 'fichas restauradas'}${skippedText}.`,
            }
          : { tone: 'error', text: `Nenhuma ficha válida encontrada nesse arquivo${skippedText}.` },
      );
    } catch {
      setMessage({ tone: 'error', text: 'Não consegui ler esse arquivo.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <TopBar
        title="Ajustes"
        leading={
          <Tappable onTap={onBack} className="icon-button" ariaLabel="Voltar">
            <span aria-hidden="true">←</span>
          </Tappable>
        }
      />

      <div className="settings">
        <Section title="Backup">
          <Card className="settings__explainer">
            <p className="dfo-body">
              {isNative()
                ? 'Suas fichas ficam salvas neste aparelho. Um backup é uma cópia extra: se você trocar de aparelho ou apagar o app sem querer, ela continua com você.'
                : 'O Boo & Dice roda direto do Safari, sem passar pela App Store — é assim que ele funciona no iPhone. Por isso as fichas ficam guardadas dentro do navegador, e o próprio iOS pode limpar esse espaço se o app passar muito tempo sem ser aberto. Um backup exportado é a única cópia que sobrevive a isso.'}
            </p>
            <p className="dfo-caption">
              Sugestão: exporte um backup a cada {BACKUP_REMINDER_DAYS} dias, ou logo depois de uma
              sessão com mudanças importantes na ficha.
            </p>
            <p className="dfo-caption settings__last-backup">
              {lastBackupAt === null
                ? 'Você ainda não fez nenhum backup.'
                : daysSince(lastBackupAt) === 0
                  ? 'Último backup: hoje.'
                  : `Último backup: há ${daysSince(lastBackupAt)} ${daysSince(lastBackupAt) === 1 ? 'dia' : 'dias'}.`}
            </p>
          </Card>

          <div className="settings__actions">
            <Button variant="primary" full disabled={busy !== null} onTap={() => void runExport()}>
              {busy === 'export' ? 'Salvando…' : 'Exportar backup'}
            </Button>
            <Button
              variant="secondary"
              full
              disabled={busy !== null}
              onTap={() => fileInputRef.current?.click()}
            >
              {busy === 'import' ? 'Restaurando…' : 'Restaurar de um backup'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="settings__file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void runImport(file);
              }}
            />
          </div>

          {message && (
            <p className={`dfo-caption settings__message settings__message--${message.tone}`}>
              {message.text}
            </p>
          )}

          {isNative() && (
            <p className="dfo-caption">
              Além disso, o app guarda sozinho uma cópia automática no aparelho de tempos em tempos,
              enquanto você joga — sem precisar fazer nada.
            </p>
          )}
        </Section>
      </div>
    </Screen>
  );
}
