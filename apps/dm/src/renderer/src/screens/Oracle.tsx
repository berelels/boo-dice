import { useEffect, useState } from 'react';
import { Button, Card, Chip } from '@dfo/ui';
import { useDmApi } from '../db/useDmApi.js';
import type { OracleAnswer } from '../../../main/oracle.js';

/**
 * O Oráculo — pergunta em linguagem natural, resposta ancorada no acervo já
 * indexado (SRD, livro, PDFs do mestre). Local, sem chave de API: a primeira
 * pergunta baixa o modelo (~1GB) uma vez, as próximas rodam offline.
 *
 * 3 perguntas por sessão de mesa, mas só enquanto uma sessão de LAN está de
 * fato no ar — fora de sessão (preparando a mesa, testando sozinho) as
 * perguntas são ilimitadas. A cota reseta a cada `session:start` novo.
 */
export function OracleCard(): JSX.Element {
  const dm = useDmApi();
  const [status, setStatus] = useState<{ remaining: number | null; modelReady: boolean } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<OracleAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void dm.oracle.status().then(setStatus);
  }, [dm]);

  useEffect(() => dm.oracle.onDownloadProgress(setProgress), [dm]);

  const download = async (): Promise<void> => {
    setDownloading(true);
    setError(null);
    try {
      await dm.oracle.downloadModel();
      setStatus(await dm.oracle.status());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível baixar o modelo.');
    } finally {
      setDownloading(false);
    }
  };

  const ask = async (): Promise<void> => {
    if (question.trim() === '') return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await dm.oracle.ask(question.trim());
      setAnswer(result);
      setStatus(await dm.oracle.status());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'O Oráculo não respondeu.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <Card className="oracle">
      <div className="dfo-headline">Oráculo</div>
      <p className="dfo-caption">
        Pergunte em português — a resposta vem só do que está indexado no Bestiário (SRD, livro,
        PDFs importados), gerada localmente, sem internet.
      </p>

      {!status ? null : !status.modelReady ? (
        <>
          {downloading ? (
            <p className="dfo-caption">Baixando o modelo… {Math.round(progress * 100)}%</p>
          ) : (
            <Button variant="ghost" onTap={() => void download()}>
              Baixar modelo (~1GB, uma vez só)
            </Button>
          )}
        </>
      ) : (
        <>
          <input
            type="text"
            className="dfo-input"
            value={question}
            placeholder="Quanto de dano causa a Bola de Fogo?"
            autoComplete="off"
            disabled={status.remaining === 0 || asking}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void ask();
            }}
          />
          <div className="oracle__footer">
            <span className="dfo-caption">
              {status.remaining === null
                ? 'Perguntas ilimitadas (sem sessão ativa)'
                : `${status.remaining} ${status.remaining === 1 ? 'pergunta restante' : 'perguntas restantes'} nesta sessão`}
            </span>
            <Button
              variant="primary"
              disabled={status.remaining === 0 || asking || question.trim() === ''}
              onTap={() => void ask()}
            >
              {asking ? 'Perguntando…' : 'Perguntar'}
            </Button>
          </div>
        </>
      )}

      {error && <p className="session__error">{error}</p>}

      {answer && (
        <div className="oracle__answer">
          <p className="dfo-body">{answer.answer}</p>
          {answer.sources.length > 0 && (
            <div className="oracle__sources">
              {answer.sources.map((source, index) => (
                <Chip key={index} title={source.section ?? undefined}>
                  {source.title}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
