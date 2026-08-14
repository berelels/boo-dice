import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  formatModifier,
  roll,
  rollD20,
  type Advantage,
  type D20Result,
  type RollResult,
} from '@dfo/core';
import { SPRING_FLICK, haptic } from '@dfo/ui';
import { useAppData } from '../db/provider.js';

/**
 * Rolagem de dados no app inteiro.
 *
 * Qualquer valor rolável da ficha chama `rollCheck` ou `rollDamage`; o
 * resultado aparece numa faixa flutuante e vai para o registro da sessão.
 *
 * A faixa mostra **os dados individuais**, não só o total. Ver o 17 no d20 é o
 * que dá emoção; ver "22" sozinho é um extrato bancário.
 */

export interface CheckRollRecord {
  readonly kind: 'check';
  readonly label: string;
  readonly result: D20Result;
}

export interface DamageRollRecord {
  readonly kind: 'damage';
  readonly label: string;
  readonly result: RollResult;
  readonly critical: boolean;
}

export type RollRecord = CheckRollRecord | DamageRollRecord;

interface RollApi {
  readonly last: RollRecord | null;
  readonly rollCheck: (label: string, modifier: number, advantage?: Advantage) => D20Result;
  readonly rollDamage: (label: string, notation: string, critical?: boolean) => RollResult;
  readonly dismiss: () => void;
}

/** Tempo que o resultado fica na tela antes de sair sozinho. */
const DISMISS_AFTER_MS = 6000;

const RollContext = createContext<RollApi | null>(null);

export function useRoller(): RollApi {
  const api = useContext(RollContext);
  if (!api) throw new Error('useRoller precisa estar dentro de <RollProvider>.');
  return api;
}

export function RollProvider({
  children,
  characterId,
}: {
  children: ReactNode;
  characterId: string | null;
}): JSX.Element {
  const { rolls } = useAppData();
  const [last, setLast] = useState<RollRecord | null>(null);
  const dismissTimer = useRef<number | null>(null);

  /**
   * A faixa some sozinha depois de alguns segundos.
   *
   * Na primeira versão ela ficava para sempre até alguém tocá-la, o que
   * significava uma rolagem antiga pairando sobre a galeria e, pior, cobrindo
   * o último controle da tela. Um resultado de dado é informação momentânea:
   * quem quiser revê-lo tem o registro da sessão.
   */
  const show = useCallback((record: RollRecord) => {
    setLast(record);
    if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(() => {
      dismissTimer.current = null;
      setLast(null);
    }, DISMISS_AFTER_MS);
  }, []);

  useEffect(
    () => () => {
      if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
    },
    [],
  );

  const log = useCallback(
    (label: string, notation: string, total: number, detail: string) => {
      // O registro é conveniência: se a gravação falhar, a rolagem já aconteceu
      // e o jogador já a viu. Não há por que interromper o jogo por causa disso.
      void rolls.append({ characterId, label, notation, total, detail }).catch(() => undefined);
    },
    [rolls, characterId],
  );

  const rollCheck = useCallback(
    (label: string, modifier: number, advantage: Advantage = 'normal'): D20Result => {
      const result = rollD20({ modifier, advantage });
      // Causalidade: o toque acontece no instante do resultado, e a força
      // acompanha o que aconteceu — crítico merece mais que um teste comum.
      haptic(result.critical === 'success' ? 'success' : result.critical === 'failure' ? 'error' : 'medium');
      show({ kind: 'check', label, result });
      log(label, `1d20${formatModifier(modifier)}`, result.total, describeCheck(result));
      return result;
    },
    [log, show],
  );

  const rollDamage = useCallback(
    (label: string, notation: string, critical = false): RollResult => {
      const result = roll(notation, { critical });
      haptic(critical ? 'heavy' : 'medium');
      show({ kind: 'damage', label, result, critical });
      log(label, notation, result.total, describeDamage(result));
      return result;
    },
    [log, show],
  );

  const dismiss = useCallback(() => setLast(null), []);

  return (
    <RollContext.Provider value={{ last, rollCheck, rollDamage, dismiss }}>
      {children}
      <RollBanner record={last} onDismiss={dismiss} />
    </RollContext.Provider>
  );
}

function describeCheck(result: D20Result): string {
  const dice = result.rolls
    .map((value, index) => (index === result.usedIndex ? `${value}` : `(${value})`))
    .join(' ');
  return `d20 ${dice} ${formatModifier(result.modifier)} = ${result.total}`;
}

function describeDamage(result: RollResult): string {
  return result.terms
    .map((term) =>
      term.term.kind === 'const'
        ? formatModifier(term.subtotal)
        : `[${term.dice.map((die) => (die.kept ? die.value : `(${die.value})`)).join(' ')}]`,
    )
    .join(' ')
    .concat(` = ${result.total}`);
}

// ---------------------------------------------------------------------------

/**
 * Faixa de resultado. Entra de baixo e sai por baixo — o mesmo caminho nas duas
 * direções, para que a origem do elemento seja óbvia.
 */
function RollBanner({
  record,
  onDismiss,
}: {
  record: RollRecord | null;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <AnimatePresence>
      {record && (
        <motion.button
          type="button"
          className="roll-banner"
          onClick={onDismiss}
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={SPRING_FLICK}
          aria-live="polite"
        >
          <div className="roll-banner__left">
            <div className="dfo-overline">{record.label}</div>
            <div className="roll-banner__dice dfo-numeric">
              {record.kind === 'check' ? (
                <CheckDice result={record.result} />
              ) : (
                <DamageDice record={record} />
              )}
            </div>
          </div>
          <div
            className={`roll-banner__total dfo-numeric${criticalClass(record)}`}
            aria-label={`Total ${totalOf(record)}`}
          >
            {totalOf(record)}
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function totalOf(record: RollRecord): number {
  return record.kind === 'check' ? record.result.total : record.result.total;
}

function criticalClass(record: RollRecord): string {
  if (record.kind !== 'check' || record.result.critical === null) return '';
  return record.result.critical === 'success'
    ? ' roll-banner__total--crit'
    : ' roll-banner__total--fumble';
}

function CheckDice({ result }: { result: D20Result }): JSX.Element {
  return (
    <>
      {result.rolls.map((value, index) => (
        <span
          key={index}
          className={`die${index === result.usedIndex ? '' : ' die--discarded'}${
            index === result.usedIndex && value === 20 ? ' die--crit' : ''
          }${index === result.usedIndex && value === 1 ? ' die--fumble' : ''}`}
        >
          {value}
        </span>
      ))}
      {result.modifier !== 0 && <span className="die-mod">{formatModifier(result.modifier)}</span>}
      {result.advantage !== 'normal' && (
        <span className="die-tag">{result.advantage === 'advantage' ? 'vantagem' : 'desvantagem'}</span>
      )}
    </>
  );
}

function DamageDice({ record }: { record: DamageRollRecord }): JSX.Element {
  return (
    <>
      {record.result.terms.map((term, termIndex) =>
        term.term.kind === 'const' ? (
          <span key={termIndex} className="die-mod">
            {formatModifier(term.subtotal)}
          </span>
        ) : (
          term.dice.map((die, dieIndex) => (
            <span
              key={`${termIndex}-${dieIndex}`}
              className={`die${die.kept ? '' : ' die--discarded'}`}
            >
              {die.value}
            </span>
          ))
        ),
      )}
      {record.critical && <span className="die-tag die-tag--crit">crítico</span>}
    </>
  );
}
