import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ABILITIES,
  ABILITY_ABBREVIATIONS,
  ABILITY_LABELS,
  CLASSES,
  CLASS_IDS,
  MAX_LEVEL,
  MIN_LEVEL,
  abilityModifier,
  createCharacter,
  formatModifier,
  roll,
  suggestedMaxHitPoints,
  type Ability,
  type ClassId,
} from '@dfo/core';
import {
  Button,
  Field,
  Screen,
  SegmentedControl,
  Tappable,
  TopBar,
  classGradientVars,
  haptic,
} from '@dfo/ui';
import { useAppData } from '../db/provider.js';
import { autoBackupIfNative } from '../state/backup.js';

/**
 * Criação de personagem.
 *
 * Só o essencial para começar a jogar: nome, classe, nível e atributos. Todo o
 * resto — perícias, equipamento, magias — se preenche na própria ficha, que é
 * onde o jogador vai estar de qualquer forma.
 *
 * O que o app preenche sozinho: proficiência nas resistências da classe (que é
 * regra fixa, não escolha) e um PV máximo sugerido.
 *
 * O primeiro personagem do aparelho passa por um assistente guiado — um passo
 * por vez, com uma frase de contexto pra quem nunca jogou. Do segundo em
 * diante, quem já passou por isso quer o formulário direto, sem passos.
 */

type ScoreMethod = 'standard' | 'roll' | 'manual';

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
// Passos 0-4 (boas-vindas, nome, classe, atributos, raça/antecedente) + o
// resumo final no índice 5 — seis telas ao todo.
const GUIDED_STEPS = 6;

export function CreateScreen({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (characterId: string) => void;
}): JSX.Element {
  const { characters } = useAppData();

  const [guided, setGuided] = useState<boolean | null>(null);
  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [classId, setClassId] = useState<ClassId>('fighter');
  const [level, setLevel] = useState(1);
  const [race, setRace] = useState('');
  const [background, setBackground] = useState('');
  const [method, setMethod] = useState<ScoreMethod>('standard');
  const [scores, setScores] = useState<Record<Ability, number>>({
    str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Só o primeiro personagem do aparelho é guiado — a partir do segundo,
    // quem chegou até aqui já sabe o que está fazendo.
    void characters.count().then((total) => setGuided(total === 0));
  }, [characters]);

  const definition = CLASSES[classId];
  const suggestedHp = useMemo(
    () => suggestedMaxHitPoints([{ classId, level }], scores.con),
    [classId, level, scores.con],
  );

  const rollScores = (): void => {
    // 4d6 mantendo os três maiores — o método clássico do PHB.
    const rolled = ABILITIES.map(() => roll('4d6kh3').total);
    haptic('heavy');
    setScores(Object.fromEntries(ABILITIES.map((ability, index) => [ability, rolled[index]!])) as Record<Ability, number>);
  };

  const applyStandardArray = (): void => {
    setScores(
      Object.fromEntries(ABILITIES.map((ability, index) => [ability, STANDARD_ARRAY[index]!])) as Record<Ability, number>,
    );
  };

  const submit = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      const character = createCharacter({
        name: name.trim() || 'Sem nome',
        classes: [{ classId, level }],
        abilities: scores,
        // Proficiência nas resistências vem da classe: é regra, não escolha.
        savingThrows: Object.fromEntries(definition.savingThrows.map((ability) => [ability, 'proficient'])),
        hitPoints: { current: suggestedHp, max: suggestedHp, temporary: 0 },
        identity: { raceLabel: race.trim(), background: background.trim() },
      });
      const saved = await characters.save(character);
      void autoBackupIfNative(characters);
      onCreated(saved.id);
    } finally {
      setSaving(false);
    }
  };

  if (guided === null) return <Screen>{null}</Screen>;

  const back = (): void => {
    if (guided && step > 0) setStep((current) => current - 1);
    else onCancel();
  };

  return (
    <Screen>
      <TopBar
        title="Novo personagem"
        subtitle={guided ? `Passo ${step + 1} de ${GUIDED_STEPS}` : undefined}
        leading={
          <Tappable onTap={back} className="icon-button" ariaLabel={guided && step > 0 ? 'Voltar um passo' : 'Cancelar'}>
            <span aria-hidden="true">←</span>
          </Tappable>
        }
      />

      <div className="create">
        {guided && (
          <GuidedStep
            step={step}
            onNext={() => setStep((current) => current + 1)}
            name={name}
            onNameChange={setName}
            classId={classId}
            onClassChange={setClassId}
            race={race}
            onRaceChange={setRace}
            background={background}
            onBackgroundChange={setBackground}
            method={method}
            onMethodChange={(next) => {
              setMethod(next);
              if (next === 'standard') applyStandardArray();
              if (next === 'roll') rollScores();
            }}
            onRollAgain={rollScores}
            scores={scores}
            onScoresChange={setScores}
            onMethodBecomeManual={() => setMethod('manual')}
            definition={definition}
            suggestedHp={suggestedHp}
            saving={saving}
            onSubmit={() => void submit()}
          />
        )}

        {guided === false && (
          <>
            <Field label="Nome">
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Bruenor Escudo-de-Batalha"
                autoComplete="off"
              />
            </Field>

            <div className="create__scores">
              <span className="dfo-overline">Classe</span>
              <ClassPicker classId={classId} onChange={setClassId} />
            </div>

            <div className="create__row">
              <Field label="Nível">
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_LEVEL}
                  max={MAX_LEVEL}
                  value={level}
                  onChange={(event) =>
                    setLevel(Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Number(event.target.value) || 1)))
                  }
                />
              </Field>
              <Field label="Dado de vida" hint={`${definition.hitDie === 12 ? 'o maior do jogo' : 'padrão da classe'}`}>
                <div className="create__readonly dfo-numeric">d{definition.hitDie}</div>
              </Field>
            </div>

            <div className="create__row">
              <Field label="Raça">
                <input
                  type="text"
                  value={race}
                  onChange={(event) => setRace(event.target.value)}
                  placeholder="Anão da montanha"
                  autoComplete="off"
                />
              </Field>
              <Field label="Antecedente">
                <input
                  type="text"
                  value={background}
                  onChange={(event) => setBackground(event.target.value)}
                  placeholder="Herói do povo"
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="create__scores">
              <div className="dfo-overline">Atributos</div>
              <AbilityMethodPicker
                method={method}
                onChange={(next) => {
                  setMethod(next);
                  if (next === 'standard') applyStandardArray();
                  if (next === 'roll') rollScores();
                }}
                onRollAgain={rollScores}
              />
              <AbilityScoresGrid
                scores={scores}
                onChange={(ability, value) => {
                  setMethod('manual');
                  setScores((current) => ({ ...current, [ability]: value }));
                }}
              />
            </div>

            <SummaryBlock definition={definition} suggestedHp={suggestedHp} />

            <Button variant="primary" full disabled={saving} onTap={() => void submit()}>
              {saving ? 'Criando…' : 'Criar personagem'}
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}

// ===========================================================================
// Assistente guiado — primeiro personagem do aparelho
// ===========================================================================

interface GuidedStepProps {
  readonly step: number;
  readonly onNext: () => void;
  readonly name: string;
  readonly onNameChange: (value: string) => void;
  readonly classId: ClassId;
  readonly onClassChange: (value: ClassId) => void;
  readonly race: string;
  readonly onRaceChange: (value: string) => void;
  readonly background: string;
  readonly onBackgroundChange: (value: string) => void;
  readonly method: ScoreMethod;
  readonly onMethodChange: (value: ScoreMethod) => void;
  readonly onRollAgain: () => void;
  readonly scores: Record<Ability, number>;
  readonly onScoresChange: (scores: Record<Ability, number>) => void;
  readonly onMethodBecomeManual: () => void;
  readonly definition: (typeof CLASSES)[ClassId];
  readonly suggestedHp: number;
  readonly saving: boolean;
  readonly onSubmit: () => void;
}

function GuidedStep(props: GuidedStepProps): JSX.Element {
  switch (props.step) {
    case 0:
      return (
        <StepShell
          title="Bem-vindo(a) ao Boo & Dice"
          blurb="Vamos criar seu primeiro personagem — nome, uma classe e alguns números. Leva menos de dois minutos, e quase tudo dá pra mudar depois, direto na ficha."
        >
          <Button variant="primary" full onTap={props.onNext}>
            Vamos lá
          </Button>
        </StepShell>
      );

    case 1:
      return (
        <StepShell title="Como ele se chama?" blurb="O nome do seu personagem — pode trocar depois, sem custo nenhum.">
          <input
            type="text"
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="Bruenor Escudo-de-Batalha"
            autoComplete="off"
            autoFocus
          />
          <Button variant="primary" full onTap={props.onNext}>
            Continuar
          </Button>
        </StepShell>
      );

    case 2:
      return (
        <StepShell
          title="O que ele sabe fazer bem?"
          blurb="A classe define as habilidades do seu personagem — de guerreiros que enfrentam qualquer perigo de frente a magos que dobram a realidade. Toque para ver as opções; dá pra trocar quando quiser."
        >
          <ClassPicker classId={props.classId} onChange={props.onClassChange} />
          <p className="dfo-caption">
            Dado de vida: <strong className="dfo-numeric">d{props.definition.hitDie}</strong> —{' '}
            {props.definition.hitDie === 12 ? 'o maior do jogo' : 'padrão da classe'}, usado pra calcular
            quantos pontos de vida ele ganha a cada nível.
          </p>
          <Button variant="primary" full onTap={props.onNext}>
            Continuar
          </Button>
        </StepShell>
      );

    case 3:
      return (
        <StepShell
          title="Força, destreza, inteligência…"
          blurb="Seis números que definem o que seu personagem faz bem, do físico ao social. 'Padrão' já vem numa distribuição equilibrada — dá pra rolar os dados ou ajustar à mão se preferir."
        >
          <AbilityMethodPicker method={props.method} onChange={props.onMethodChange} onRollAgain={props.onRollAgain} />
          <AbilityScoresGrid
            scores={props.scores}
            onChange={(ability, value) => {
              props.onMethodBecomeManual();
              props.onScoresChange({ ...props.scores, [ability]: value });
            }}
          />
          <Button variant="primary" full onTap={props.onNext}>
            Continuar
          </Button>
        </StepShell>
      );

    case 4:
      return (
        <StepShell
          title="De onde ele veio?"
          blurb="Raça e antecedente são sobre quem seu personagem é, não sobre poder — de onde veio, o que fazia antes da aventura. Pode preencher agora ou deixar em branco e decidir na mesa."
        >
          <Field label="Raça">
            <input
              type="text"
              value={props.race}
              onChange={(event) => props.onRaceChange(event.target.value)}
              placeholder="Anão da montanha"
              autoComplete="off"
            />
          </Field>
          <Field label="Antecedente">
            <input
              type="text"
              value={props.background}
              onChange={(event) => props.onBackgroundChange(event.target.value)}
              placeholder="Herói do povo"
              autoComplete="off"
            />
          </Field>
          <Button variant="primary" full onTap={props.onNext}>
            Continuar
          </Button>
        </StepShell>
      );

    default:
      return (
        <StepShell title="Tudo pronto" blurb="Confira e crie — depois é só abrir a ficha pra ajustar qualquer coisa.">
          <SummaryBlock definition={props.definition} suggestedHp={props.suggestedHp} />
          <Button variant="primary" full disabled={props.saving} onTap={props.onSubmit}>
            {props.saving ? 'Criando…' : 'Criar personagem'}
          </Button>
        </StepShell>
      );
  }
}

function StepShell({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="create__step">
      <h2 className="dfo-title">{title}</h2>
      <p className="dfo-caption create__step-blurb">{blurb}</p>
      {children}
    </div>
  );
}

// ===========================================================================
// Blocos reaproveitados entre o formulário direto e o assistente guiado
// ===========================================================================

function ClassPicker({ classId, onChange }: { classId: ClassId; onChange: (id: ClassId) => void }): JSX.Element {
  return (
    <div className="class-picker">
      {CLASS_IDS.map((id) => (
        <Tappable
          as="div"
          key={id}
          className={`class-option${id === classId ? ' is-selected' : ''}`}
          style={classGradientVars(id)}
          hapticOnTap
          ariaLabel={CLASSES[id].label}
          onTap={() => onChange(id)}
        >
          <span className="class-option__name">{CLASSES[id].label}</span>
          <span className="class-option__die">d{CLASSES[id].hitDie}</span>
        </Tappable>
      ))}
    </div>
  );
}

function AbilityMethodPicker({
  method,
  onChange,
  onRollAgain,
}: {
  method: ScoreMethod;
  onChange: (method: ScoreMethod) => void;
  onRollAgain: () => void;
}): JSX.Element {
  return (
    <>
      <SegmentedControl
        value={method}
        onChange={onChange}
        options={[
          { value: 'standard', label: 'Padrão' },
          { value: 'roll', label: 'Rolar' },
          { value: 'manual', label: 'Manual' },
        ]}
      />
      {method === 'roll' && (
        <Button variant="secondary" full onTap={onRollAgain}>
          Rolar de novo (4d6, descarta o menor)
        </Button>
      )}
    </>
  );
}

function AbilityScoresGrid({
  scores,
  onChange,
}: {
  scores: Record<Ability, number>;
  onChange: (ability: Ability, value: number) => void;
}): JSX.Element {
  return (
    <div className="create__abilities">
      {ABILITIES.map((ability) => (
        <label key={ability} className="create__ability">
          <span className="dfo-overline">{ABILITY_ABBREVIATIONS[ability]}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            value={scores[ability]}
            aria-label={ABILITY_LABELS[ability]}
            onChange={(event) => onChange(ability, Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
          />
          <span className="create__ability-mod dfo-numeric">{formatModifier(abilityModifier(scores[ability]))}</span>
        </label>
      ))}
    </div>
  );
}

function SummaryBlock({
  definition,
  suggestedHp,
}: {
  definition: (typeof CLASSES)[ClassId];
  suggestedHp: number;
}): JSX.Element {
  return (
    <div className="create__summary">
      <div className="dfo-caption">
        Proficiência em resistência de{' '}
        <strong>{definition.savingThrows.map((ability) => ABILITY_LABELS[ability]).join(' e ')}</strong>, pela
        classe.
      </div>
      <div className="dfo-caption">
        PV máximo sugerido: <strong className="dfo-numeric">{suggestedHp}</strong> — dá para ajustar na ficha
        se a sua mesa rola os dados.
      </div>
    </div>
  );
}
