import { useMemo, useState } from 'react';
import {
  ABILITIES,
  ABILITY_ABBREVIATIONS,
  ABILITY_LABELS,
  CLASSES,
  CLASS_IDS,
  CONDITIONS,
  CONDITION_DEFINITIONS,
  COINS,
  COIN_LABELS,
  ENCUMBRANCE_LABELS,
  EMPTY_DEATH_SAVES,
  MAX_ABILITY_SCORE,
  MAX_EXHAUSTION,
  MAX_LEVEL,
  MIN_ABILITY_SCORE,
  SKILL_DEFINITIONS,
  abilitiesAtOrAboveCap,
  applyDamage,
  applyDeathSave,
  applyHealing,
  applyTemporaryHitPoints,
  classSummary,
  concentrationSaveDc,
  deriveCharacter,
  exhaustionEffects,
  formatModifier,
  highestSlotLevel,
  levelForXp,
  longRest,
  pactMagic,
  primaryClassId,
  rollD20,
  shortRest,
  spellLevelLabel,
  suggestedMaxHitPoints,
  totalLevel,
  xpToNextLevel,
  type Ability,
  type Character,
  type ClassId,
  type DerivedCharacter,
  type Skill,
  type SpellEntry,
} from '@dfo/core';
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  Chip,
  HeroCard,
  Screen,
  Section,
  SegmentedControl,
  StatTile,
  Stepper,
  Tappable,
  classGradientVars,
  haptic,
} from '@dfo/ui';
import { useCharacter } from '../state/useCharacter.js';
import { useRoller } from '../state/rolling.js';
import { pickPortrait } from '../components/portrait.js';
import { SpellPicker } from '../components/SpellPicker.js';
import { groupSpellsByLevel } from '../components/spellHelpers.js';
import { useAppData } from '../db/provider.js';

/**
 * A ficha.
 *
 * Duas regras valem para a tela inteira:
 *
 * 1. **Nada calculável é guardado.** Bônus de proficiência, modificadores, CA e
 *    espaços de magia saem de `deriveCharacter` a cada render. Só o que é
 *    decisão do jogador vive no banco.
 * 2. **Tudo que muda numa mesa é editável aqui.** Nível, atributos, PV, magias,
 *    foto — nada exige recriar o personagem.
 */

type Tab = 'combate' | 'pericias' | 'magias' | 'bolsa' | 'perfil';

export function SheetScreen({
  characterId,
  onBack,
  onDeleted,
  onGlossary,
}: {
  characterId: string;
  onBack: () => void;
  /** Chamado após a exclusão ser gravada — força a Galeria a recarregar a lista. */
  onDeleted: () => void;
  onGlossary: () => void;
}): JSX.Element {
  const { characters } = useAppData();
  const { character, error, update, discardPendingSave } = useCharacter(characterId);
  const [tab, setTab] = useState<Tab>('combate');
  const [identitySheet, setIdentitySheet] = useState(false);

  const remove = async (): Promise<void> => {
    discardPendingSave();
    await characters.delete(characterId);
    onDeleted();
    onBack();
  };

  const derived = useMemo(() => (character ? deriveCharacter(character) : null), [character]);

  if (error) {
    return (
      <Screen>
        <div className="sheet__error dfo-caption">{error}</div>
        <div className="sheet__error">
          <Button variant="secondary" onTap={onBack}>
            Voltar
          </Button>
        </div>
      </Screen>
    );
  }

  if (!character || !derived) {
    return (
      <Screen>
        <div className="sheet__loading dfo-caption">Abrindo a ficha…</div>
      </Screen>
    );
  }

  const accent = primaryClassId(character);

  const changePortrait = async (): Promise<void> => {
    const dataUrl = await pickPortrait();
    if (dataUrl) {
      haptic('success');
      update((current) => ({ ...current, portraitDataUrl: dataUrl }));
    }
  };

  return (
    <Screen>
      <div className="sheet__hero" style={classGradientVars(accent)}>
        <div className="sheet__hero-bar">
          <Tappable onTap={onBack} className="icon-button icon-button--glass" ariaLabel="Voltar">
            <span aria-hidden="true">←</span>
          </Tappable>
          <Tappable
            onTap={onGlossary}
            className="icon-button icon-button--glass"
            ariaLabel="Abrir o glossário"
          >
            <span aria-hidden="true">?</span>
          </Tappable>
        </div>

        <HeroCard
          accent={accent}
          eyebrow={classSummary(character)}
          title={character.name}
          subtitle={[
            character.identity.raceLabel,
            character.identity.background,
          ]
            .filter(Boolean)
            .join(' · ')}
          level={character.portraitDataUrl ? undefined : derived.totalLevel}
          portrait={character.portraitDataUrl}
          footer={
            <>
              <span className="hero__chip">nível {derived.totalLevel}</span>
              <span className="hero__chip">prof {formatModifier(derived.proficiencyBonus)}</span>
              <span className="hero__chip">CA {derived.armorClass.total}</span>
              <Tappable
                as="div"
                className="hero__chip hero__chip--action"
                onTap={() => setIdentitySheet(true)}
              >
                editar
              </Tappable>
            </>
          }
        />

        <div className="sheet__avatar-slot">
          <Avatar
            src={character.portraitDataUrl}
            name={character.name}
            accent={accent}
            size={64}
            onTap={() => void changePortrait()}
          />
        </div>
      </div>

      <div className="sheet__tabs">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: 'combate', label: 'Combate' },
            { value: 'pericias', label: 'Testes' },
            { value: 'magias', label: 'Magias' },
            { value: 'bolsa', label: 'Bolsa' },
            { value: 'perfil', label: 'Perfil' },
          ]}
        />
      </div>

      {tab === 'combate' && <CombatTab character={character} derived={derived} update={update} />}
      {tab === 'pericias' && <ChecksTab character={character} derived={derived} update={update} />}
      {tab === 'magias' && <SpellsTab character={character} derived={derived} update={update} />}
      {tab === 'bolsa' && <PouchTab character={character} derived={derived} update={update} />}
      {tab === 'perfil' && <ProfileTab character={character} derived={derived} update={update} />}

      <BottomSheet
        open={identitySheet}
        onClose={() => setIdentitySheet(false)}
        title="Identidade"
      >
        <IdentityEditor
          character={character}
          update={update}
          onChangePortrait={() => void changePortrait()}
          onDone={() => setIdentitySheet(false)}
          onDelete={() => void remove()}
        />
      </BottomSheet>
    </Screen>
  );
}

interface TabProps {
  readonly character: Character;
  readonly derived: DerivedCharacter;
  readonly update: (change: (current: Character) => Character) => void;
}

// ===========================================================================
// Identidade
// ===========================================================================

function IdentityEditor({
  character,
  update,
  onChangePortrait,
  onDone,
  onDelete,
}: {
  character: Character;
  update: TabProps['update'];
  onChangePortrait: () => void;
  onDone: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const field = (
    label: string,
    value: string,
    apply: (next: string) => Character,
    placeholder?: string,
  ): JSX.Element => (
    <label className="dfo-field">
      <span className="dfo-overline">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => update(() => apply(event.target.value))}
      />
    </label>
  );

  return (
    <div className="editor">
      <div className="editor__portrait">
        <Avatar
          src={character.portraitDataUrl}
          name={character.name}
          accent={primaryClassId(character)}
          size={88}
          onTap={onChangePortrait}
        />
        <div className="editor__portrait-actions">
          <Button variant="secondary" onTap={onChangePortrait}>
            {character.portraitDataUrl ? 'Trocar foto' : 'Adicionar foto'}
          </Button>
          {character.portraitDataUrl && (
            <Button
              variant="ghost"
              onTap={() => update((current) => ({ ...current, portraitDataUrl: null }))}
            >
              Remover
            </Button>
          )}
        </div>
      </div>

      {field('Nome', character.name, (next) => ({ ...character, name: next }))}
      {field(
        'Raça',
        character.identity.raceLabel,
        (next) => ({ ...character, identity: { ...character.identity, raceLabel: next } }),
        'Anão da montanha',
      )}
      {field(
        'Antecedente',
        character.identity.background,
        (next) => ({ ...character, identity: { ...character.identity, background: next } }),
        'Herói do povo',
      )}
      {field(
        'Tendência',
        character.identity.alignment,
        (next) => ({ ...character, identity: { ...character.identity, alignment: next } }),
        'Leal e bom',
      )}
      {field(
        'Jogador',
        character.identity.playerName,
        (next) => ({ ...character, identity: { ...character.identity, playerName: next } }),
      )}

      <Button variant="primary" full onTap={onDone}>
        Pronto
      </Button>

      <div className="editor__danger">
        {confirmingDelete ? (
          <>
            <p className="dfo-caption editor__danger-warning">
              Excluir {character.name || 'este personagem'} apaga a ficha do aparelho — não tem como
              desfazer.
            </p>
            <div className="editor__danger-actions">
              <Button variant="secondary" full onTap={() => setConfirmingDelete(false)}>
                Cancelar
              </Button>
              <Button variant="danger" full onTap={onDelete}>
                Sim, excluir
              </Button>
            </div>
          </>
        ) : (
          <Button variant="ghost" full onTap={() => setConfirmingDelete(true)}>
            Excluir personagem
          </Button>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Combate
// ===========================================================================

function CombatTab({ character, derived, update }: TabProps): JSX.Element {
  const { rollCheck, rollDamage } = useRoller();
  const [hpSheet, setHpSheet] = useState(false);
  const [conditionSheet, setConditionSheet] = useState(false);
  const [acSheet, setAcSheet] = useState(false);
  const [defenseSheet, setDefenseSheet] = useState(false);

  const downed = character.hitPoints.current === 0;
  const hpRatio = character.hitPoints.max > 0 ? character.hitPoints.current / character.hitPoints.max : 0;

  return (
    <>
      <Section title="Vitalidade">
        <Card className="vitals">
          <Tappable as="div" className="vitals__hp" onTap={() => setHpSheet(true)} hapticOnTap>
            <div className="vitals__hp-head">
              <span className="dfo-overline">Pontos de vida</span>
              {character.hitPoints.temporary > 0 && (
                <Chip tone="success">+{character.hitPoints.temporary} temp</Chip>
              )}
            </div>
            <div className={`vitals__hp-value dfo-numeric${downed ? ' is-down' : ''}`}>
              {character.hitPoints.current}
              <span className="stat__of">/{character.hitPoints.max}</span>
            </div>
            {/* A barra dá a leitura instantânea que um número sozinho não dá:
                "estou pela metade" é mais rápido de ver do que de calcular. */}
            <div className="vitals__bar" role="presentation">
              <div
                className={`vitals__bar-fill${hpRatio <= 0.25 ? ' is-critical' : ''}`}
                style={{ width: `${Math.max(0, Math.min(1, hpRatio)) * 100}%` }}
              />
            </div>
          </Tappable>

          <div className="grid grid--3">
            <StatTile label="CA" value={derived.armorClass.total} onTap={() => setAcSheet(true)} />
            <StatTile
              label="Iniciativa"
              value={formatModifier(derived.initiative)}
              onTap={() => rollCheck('Iniciativa', derived.initiative)}
            />
            <StatTile
              label="Deslocamento"
              value={`${character.speedMeters}`}
              hint="metros"
              onTap={() => setDefenseSheet(true)}
            />
          </div>

          <div className="grid grid--3 grid--tight">
            <StatTile label="Percepção passiva" value={derived.passivePerception} size="sm" />
            <StatTile label="Investigação" value={derived.passiveInvestigation} size="sm" />
            <StatTile
              label="Inspiração"
              value={character.inspiration ? '✦' : '—'}
              size="sm"
              tone={character.inspiration ? 'accent' : undefined}
              onTap={() => {
                haptic('light');
                update((current) => ({ ...current, inspiration: !current.inspiration }));
              }}
            />
          </div>
        </Card>
      </Section>

      {downed && <DeathSaves character={character} update={update} />}

      <Section title="Descanso">
        <Card>
          <div className="hitdice">
            {derived.hitDice.map((pool) => (
              <div key={pool.die} className="hitdice__pool">
                <div className="dfo-headline dfo-numeric">
                  {pool.available}
                  <span className="stat__of">/{pool.total}</span> d{pool.die}
                </div>
                <Button
                  variant="secondary"
                  disabled={
                    pool.available === 0 || character.hitPoints.current >= character.hitPoints.max
                  }
                  onTap={() => {
                    const conMod = derived.abilityModifiers.con;
                    const result = rollDamage(
                      `Dado de vida d${pool.die}`,
                      `1d${pool.die}${formatModifier(conMod)}`,
                    );
                    const healed = Math.max(1, result.total);
                    update((current) => ({
                      ...current,
                      hitPoints: applyHealing(current.hitPoints, healed),
                      hitDiceSpent: {
                        ...current.hitDiceSpent,
                        [String(pool.die)]: (current.hitDiceSpent[String(pool.die)] ?? 0) + 1,
                      },
                    }));
                  }}
                >
                  Gastar 1
                </Button>
              </div>
            ))}
          </div>
          <div className="rest-buttons">
            <Button
              variant="secondary"
              onTap={() => {
                haptic('success');
                update((current) => shortRest(current).character);
              }}
            >
              Descanso curto
            </Button>
            <Button
              variant="primary"
              onTap={() => {
                haptic('success');
                update((current) => longRest(current).character);
              }}
            >
              Descanso longo
            </Button>
          </div>
        </Card>
      </Section>

      <Section
        title="Condições"
        action={
          <Tappable onTap={() => setConditionSheet(true)} className="link-button">
            editar
          </Tappable>
        }
      >
        <div className="chips">
          {derived.activeConditions.size === 0 && character.exhaustion === 0 && (
            <span className="dfo-caption">Nenhuma condição ativa.</span>
          )}
          {[...derived.activeConditions].map((condition) => (
            <Chip key={condition} tone="danger" title={CONDITION_DEFINITIONS[condition].summary}>
              {CONDITION_DEFINITIONS[condition].label}
            </Chip>
          ))}
          {character.exhaustion > 0 && (
            <Chip tone="danger" title={exhaustionEffects(character.exhaustion).join(' · ')}>
              Exaustão {character.exhaustion}
            </Chip>
          )}
        </div>
        {character.spellcasting.concentratingOn && (
          <div className="concentration">
            <Chip tone="accent">Concentrando em {character.spellcasting.concentratingOn}</Chip>
            <Tappable
              className="link-button"
              onTap={() =>
                update((current) => ({
                  ...current,
                  spellcasting: { ...current.spellcasting, concentratingOn: null },
                }))
              }
            >
              soltar
            </Tappable>
          </div>
        )}
      </Section>

      <Section title="Ataques">
        {derived.attacks.length === 0 && (
          <Card>
            <span className="dfo-caption">
              Nenhum ataque cadastrado. Adicione um para rolar acerto e dano com um toque.
            </span>
          </Card>
        )}
        {derived.attacks.map((entry) => (
          <Card key={entry.attack.id} className="attack">
            <div className="attack__head">
              <span className="dfo-headline">{entry.attack.label}</span>
              <Tappable
                className="link-button"
                ariaLabel={`Remover ${entry.attack.label}`}
                onTap={() =>
                  update((current) => ({
                    ...current,
                    attacks: current.attacks.filter((a) => a.id !== entry.attack.id),
                  }))
                }
              >
                remover
              </Tappable>
            </div>
            <div className="attack__actions">
              <Tappable
                className="attack__button"
                hapticOnTap
                onTap={() => rollCheck(`${entry.attack.label} — acerto`, entry.attackBonus)}
              >
                <span className="dfo-overline">Acerto</span>
                <span className="dfo-numeric">{formatModifier(entry.attackBonus)}</span>
              </Tappable>
              <Tappable
                className="attack__button attack__button--damage"
                hapticOnTap
                onTap={() => rollDamage(`${entry.attack.label} — dano`, entry.damageNotation)}
                onLongPress={() =>
                  rollDamage(`${entry.attack.label} — dano crítico`, entry.damageNotation, true)
                }
              >
                <span className="dfo-overline">Dano</span>
                <span className="dfo-numeric">{entry.damageNotation}</span>
              </Tappable>
            </div>
            <div className="dfo-caption">
              {[entry.attack.damageType, entry.attack.range].filter(Boolean).join(' · ')} · segure
              no dano para crítico
            </div>
          </Card>
        ))}
        <AddAttack update={update} />
      </Section>

      <BottomSheet open={hpSheet} onClose={() => setHpSheet(false)} title="Pontos de vida">
        <HitPointEditor
          character={character}
          derived={derived}
          update={update}
          onDone={() => setHpSheet(false)}
        />
      </BottomSheet>

      <BottomSheet open={acSheet} onClose={() => setAcSheet(false)} title="Classe de Armadura">
        <ul className="breakdown">
          {derived.armorClass.breakdown.map((part, index) => (
            <li key={index}>
              <span>{part.source}</span>
              <span className="dfo-numeric">{formatModifier(part.value)}</span>
            </li>
          ))}
          <li className="breakdown__total">
            <span>Total</span>
            <span className="dfo-numeric">{derived.armorClass.total}</span>
          </li>
        </ul>
        <Button variant="secondary" full onTap={() => { setAcSheet(false); setDefenseSheet(true); }}>
          Ajustar defesa
        </Button>
      </BottomSheet>

      <BottomSheet open={defenseSheet} onClose={() => setDefenseSheet(false)} title="Defesa">
        <DefenseEditor character={character} update={update} onDone={() => setDefenseSheet(false)} />
      </BottomSheet>

      <BottomSheet open={conditionSheet} onClose={() => setConditionSheet(false)} title="Condições">
        <ConditionEditor character={character} update={update} />
      </BottomSheet>
    </>
  );
}

function DefenseEditor({
  character,
  update,
  onDone,
}: {
  character: Character;
  update: TabProps['update'];
  onDone: () => void;
}): JSX.Element {
  const bonus = character.armor.bonuses.find((b) => b.source === 'Ajuste manual')?.value ?? 0;

  return (
    <div className="editor">
      <Stepper
        label="Deslocamento"
        suffix="m"
        value={character.speedMeters}
        min={0}
        max={60}
        onChange={(value) => update((current) => ({ ...current, speedMeters: value }))}
      />

      <Stepper
        label="Bônus de CA"
        value={bonus}
        min={-5}
        max={15}
        onChange={(value) =>
          update((current) => ({
            ...current,
            armor: {
              ...current.armor,
              bonuses: [
                ...current.armor.bonuses.filter((b) => b.source !== 'Ajuste manual'),
                ...(value === 0 ? [] : [{ source: 'Ajuste manual', value }]),
              ],
            },
          }))
        }
      />

      <Stepper
        label="Bônus de iniciativa"
        value={character.initiativeBonus}
        min={-5}
        max={15}
        onChange={(value) => update((current) => ({ ...current, initiativeBonus: value }))}
      />

      <label className="dfo-field">
        <span className="dfo-overline">Escudo</span>
        <Tappable
          as="div"
          className={`toggle${character.armor.shield ? ' is-on' : ''}`}
          onTap={() =>
            update((current) => ({
              ...current,
              armor: { ...current.armor, shield: !current.armor.shield },
            }))
          }
        >
          <span>{character.armor.shield ? 'Empunhando escudo (+2)' : 'Sem escudo'}</span>
        </Tappable>
      </label>

      <label className="dfo-field">
        <span className="dfo-overline">Defesa sem armadura</span>
        <select
          value={character.armor.unarmoredDefense ?? ''}
          onChange={(event) =>
            update((current) => ({
              ...current,
              armor: {
                ...current.armor,
                unarmoredDefense:
                  event.target.value === ''
                    ? null
                    : (event.target.value as 'barbarian' | 'monk'),
              },
            }))
          }
        >
          <option value="">Nenhuma</option>
          <option value="barbarian">Bárbaro (10 + Des + Con)</option>
          <option value="monk">Monge (10 + Des + Sab)</option>
        </select>
      </label>

      <Button variant="primary" full onTap={onDone}>
        Pronto
      </Button>
    </div>
  );
}

function DeathSaves({
  character,
  update,
}: {
  character: Character;
  update: TabProps['update'];
}): JSX.Element {
  const { rollCheck } = useRoller();

  return (
    <Section title="Testes contra a morte">
      <Card>
        <div className="death">
          <div className="death__track">
            <span className="dfo-overline">Sucessos</span>
            <div className="death__pips">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className={`pip${index < character.deathSaves.successes ? ' pip--on pip--success' : ''}`}
                />
              ))}
            </div>
          </div>
          <div className="death__track">
            <span className="dfo-overline">Falhas</span>
            <div className="death__pips">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className={`pip${index < character.deathSaves.failures ? ' pip--on pip--failure' : ''}`}
                />
              ))}
            </div>
          </div>
        </div>
        <Button
          variant="danger"
          full
          onTap={() => {
            const result = rollD20();
            rollCheck('Teste contra a morte', 0);
            const outcome = applyDeathSave(character.deathSaves, result);
            haptic(
              outcome.outcome === 'dead'
                ? 'error'
                : outcome.outcome === 'revived'
                  ? 'success'
                  : 'warning',
            );
            update((current) => ({
              ...current,
              deathSaves: outcome.saves,
              hitPoints:
                outcome.outcome === 'revived'
                  ? { ...current.hitPoints, current: 1 }
                  : current.hitPoints,
            }));
          }}
        >
          Rolar teste contra a morte
        </Button>
        <div className="dfo-caption">
          20 natural volta com 1 PV · 1 natural conta como duas falhas
        </div>
      </Card>
    </Section>
  );
}

function HitPointEditor({
  character,
  derived,
  update,
  onDone,
}: {
  character: Character;
  derived: DerivedCharacter;
  update: TabProps['update'];
  onDone: () => void;
}): JSX.Element {
  const [amount, setAmount] = useState(1);
  const concentrating = character.spellcasting.concentratingOn !== null;
  const suggested = suggestedMaxHitPoints(character.classes, character.abilities[('con' as Ability)]);

  return (
    <div className="hp-editor">
      <div className="hp-editor__current dfo-numeric">
        {character.hitPoints.current}
        <span className="stat__of">/{character.hitPoints.max}</span>
        {character.hitPoints.temporary > 0 && (
          <span className="hp-editor__temp">+{character.hitPoints.temporary}</span>
        )}
      </div>

      <div className="hp-editor__amount">
        {[1, 5, 10].map((step) => (
          <Tappable
            key={step}
            className={`chip-button${amount === step ? ' is-active' : ''}`}
            onTap={() => setAmount(step)}
          >
            {step}
          </Tappable>
        ))}
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={amount}
          onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
          aria-label="Quantidade"
          className="dfo-input"
        />
      </div>

      <div className="hp-editor__actions">
        <Button
          variant="danger"
          onTap={() => {
            const result = applyDamage(character.hitPoints, amount);
            haptic(result.instantDeath ? 'error' : result.downed ? 'warning' : 'heavy');
            update((current) => ({ ...current, hitPoints: result.hitPoints }));
          }}
        >
          Dano −{amount}
        </Button>
        <Button
          variant="secondary"
          onTap={() => {
            haptic('success');
            update((current) => ({
              ...current,
              hitPoints: applyHealing(current.hitPoints, amount),
            }));
          }}
        >
          Cura +{amount}
        </Button>
        <Button
          variant="ghost"
          onTap={() =>
            update((current) => ({
              ...current,
              hitPoints: applyTemporaryHitPoints(current.hitPoints, amount),
            }))
          }
        >
          Temp {amount}
        </Button>
      </div>

      {concentrating && (
        <div className="hp-editor__hint dfo-caption">
          Concentrando: ao sofrer {amount} de dano, o teste de Constituição é CD{' '}
          <strong className="dfo-numeric">{concentrationSaveDc(amount)}</strong>.
        </div>
      )}

      <Stepper
        label="PV máximo"
        value={character.hitPoints.max}
        min={1}
        max={999}
        onChange={(max) =>
          update((current) => ({
            ...current,
            hitPoints: {
              ...current.hitPoints,
              max,
              current: Math.min(current.hitPoints.current, max),
            },
          }))
        }
      />

      {suggested !== character.hitPoints.max && (
        <Button
          variant="ghost"
          full
          onTap={() =>
            update((current) => ({
              ...current,
              hitPoints: { ...current.hitPoints, max: suggested, current: suggested },
            }))
          }
        >
          Usar o sugerido para nível {derived.totalLevel}: {suggested} PV
        </Button>
      )}

      <Button variant="primary" full onTap={onDone}>
        Pronto
      </Button>
    </div>
  );
}

function ConditionEditor({
  character,
  update,
}: {
  character: Character;
  update: TabProps['update'];
}): JSX.Element {
  const active = new Set(character.conditions);

  return (
    <div className="condition-editor">
      {CONDITIONS.map((condition) => {
        const definition = CONDITION_DEFINITIONS[condition];
        const on = active.has(condition);
        return (
          <Tappable
            as="div"
            key={condition}
            className={`condition${on ? ' condition--on' : ''}`}
            hapticOnTap
            onTap={() =>
              update((current) => ({
                ...current,
                conditions: on
                  ? current.conditions.filter((entry) => entry !== condition)
                  : [...current.conditions, condition],
              }))
            }
          >
            <div className="dfo-headline">{definition.label}</div>
            <div className="dfo-caption">{definition.summary}</div>
          </Tappable>
        );
      })}

      <div className="exhaustion">
        <span className="dfo-overline">Exaustão</span>
        <div className="exhaustion__levels">
          {Array.from({ length: MAX_EXHAUSTION + 1 }, (_, level) => (
            <Tappable
              key={level}
              className={`chip-button${character.exhaustion === level ? ' is-active' : ''}`}
              onTap={() => update((current) => ({ ...current, exhaustion: level }))}
            >
              {level}
            </Tappable>
          ))}
        </div>
        {character.exhaustion > 0 && (
          <ul className="exhaustion__effects dfo-caption">
            {exhaustionEffects(character.exhaustion).map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddAttack({ update }: { update: TabProps['update'] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [dice, setDice] = useState('1d8');
  const [damageType, setDamageType] = useState('');
  const [ability, setAbility] = useState<Ability>('str');
  const [magicBonus, setMagicBonus] = useState(0);

  return (
    <>
      <Button variant="secondary" full onTap={() => setOpen(true)}>
        + Adicionar ataque
      </Button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Novo ataque">
        <div className="editor">
          <label className="dfo-field">
            <span className="dfo-overline">Nome</span>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Espada longa"
            />
          </label>
          <label className="dfo-field">
            <span className="dfo-overline">Dados de dano</span>
            <input
              type="text"
              value={dice}
              onChange={(event) => setDice(event.target.value)}
              placeholder="1d8"
            />
          </label>
          <label className="dfo-field">
            <span className="dfo-overline">Tipo de dano</span>
            <input
              type="text"
              value={damageType}
              onChange={(event) => setDamageType(event.target.value)}
              placeholder="cortante"
            />
          </label>
          <label className="dfo-field">
            <span className="dfo-overline">Atributo</span>
            <select value={ability} onChange={(event) => setAbility(event.target.value as Ability)}>
              {ABILITIES.map((entry) => (
                <option key={entry} value={entry}>
                  {ABILITY_LABELS[entry]}
                </option>
              ))}
            </select>
          </label>
          <Stepper label="Bônus mágico" value={magicBonus} min={0} max={3} onChange={setMagicBonus} />
          <Button
            variant="primary"
            full
            onTap={() => {
              update((current) => ({
                ...current,
                attacks: [
                  ...current.attacks,
                  {
                    id: crypto.randomUUID(),
                    label: label.trim() || 'Ataque',
                    ability,
                    proficient: true,
                    damageDice: dice.trim() || '1d4',
                    damageType: damageType.trim(),
                    range: 'Corpo a corpo',
                    properties: [],
                    magicBonus,
                    attackBonusOverride: null,
                    notes: '',
                  },
                ],
              }));
              setLabel('');
              setDamageType('');
              setMagicBonus(0);
              setOpen(false);
            }}
          >
            Adicionar
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

// ===========================================================================
// Testes
// ===========================================================================

function ChecksTab({ character, derived, update }: TabProps): JSX.Element {
  const { rollCheck } = useRoller();
  const [abilitySheet, setAbilitySheet] = useState(false);
  const overCapAbilities = abilitiesAtOrAboveCap(character.abilities);

  const cycleProficiency = (skill: Skill): void => {
    const order = ['none', 'proficient', 'expertise', 'half'] as const;
    const currentLevel = character.skills[skill] ?? 'none';
    const next = order[(order.indexOf(currentLevel as (typeof order)[number]) + 1) % order.length]!;
    haptic('light');
    update((current) => ({ ...current, skills: { ...current.skills, [skill]: next } }));
  };

  const cycleSave = (ability: Ability): void => {
    const currentLevel = character.savingThrows[ability] ?? 'none';
    haptic('light');
    update((current) => ({
      ...current,
      savingThrows: {
        ...current.savingThrows,
        [ability]: currentLevel === 'proficient' ? 'none' : 'proficient',
      },
    }));
  };

  return (
    <>
      <Section
        title="Atributos"
        action={
          <Tappable onTap={() => setAbilitySheet(true)} className="link-button">
            editar
          </Tappable>
        }
      >
        <div className="grid grid--3">
          {ABILITIES.map((ability) => (
            <StatTile
              key={ability}
              label={ABILITY_LABELS[ability]}
              value={formatModifier(derived.abilityModifiers[ability])}
              hint={String(character.abilities[ability])}
              onTap={() =>
                rollCheck(`Teste de ${ABILITY_LABELS[ability]}`, derived.abilityModifiers[ability])
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Testes de resistência">
        <Card>
          <ul className="rows">
            {derived.savingThrows.map((save) => (
              <li key={save.ability}>
                <div className="row">
                  <Tappable
                    className={`prof prof--${save.proficiency}`}
                    ariaLabel={`Alternar proficiência em resistência de ${ABILITY_LABELS[save.ability]}`}
                    onTap={() => cycleSave(save.ability)}
                    pressScale={0.85}
                  />
                  <Tappable
                    as="div"
                    className="row__tap"
                    hapticOnTap
                    onTap={() =>
                      rollCheck(`Resistência de ${ABILITY_LABELS[save.ability]}`, save.modifier)
                    }
                  >
                    <span className="row__label">{ABILITY_LABELS[save.ability]}</span>
                    <span className="row__value dfo-numeric">{formatModifier(save.modifier)}</span>
                  </Tappable>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Perícias">
        <Card>
          <ul className="rows">
            {[...derived.skills]
              .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
              .map((skill) => (
                <li key={skill.skill}>
                  <div className="row">
                    {/* O ponto de proficiência é seu próprio alvo de toque:
                        tocar no nome rola, tocar no ponto muda o treino. */}
                    <Tappable
                      className={`prof prof--${skill.proficiency}`}
                      ariaLabel={`Alternar proficiência em ${skill.label}`}
                      onTap={() => cycleProficiency(skill.skill)}
                      pressScale={0.85}
                    />
                    <Tappable
                      as="div"
                      className="row__tap"
                      hapticOnTap
                      onTap={() => rollCheck(skill.label, skill.modifier)}
                    >
                      <span className="row__label">
                        {skill.label}
                        <span className="row__ability">
                          {ABILITY_ABBREVIATIONS[SKILL_DEFINITIONS[skill.skill].ability]}
                        </span>
                      </span>
                      <span className="row__value dfo-numeric">
                        {formatModifier(skill.modifier)}
                      </span>
                    </Tappable>
                  </div>
                </li>
              ))}
          </ul>
          <div className="dfo-caption">
            Toque no nome para rolar; toque no ponto para alternar entre nenhuma, proficiente,
            especialista e proficiência parcial.
          </div>
        </Card>
      </Section>

      <BottomSheet open={abilitySheet} onClose={() => setAbilitySheet(false)} title="Atributos">
        <div className="editor">
          {ABILITIES.map((ability) => (
            <Stepper
              key={ability}
              label={ABILITY_LABELS[ability]}
              value={character.abilities[ability]}
              min={MIN_ABILITY_SCORE}
              max={MAX_ABILITY_SCORE}
              suffix={formatModifier(derived.abilityModifiers[ability])}
              onChange={(value) =>
                update((current) => ({
                  ...current,
                  abilities: { ...current.abilities, [ability]: value },
                }))
              }
            />
          ))}
          {overCapAbilities.length > 0 && (
            <p className="dfo-caption ability-cap-warning">
              {overCapAbilities.map((ability) => ABILITY_LABELS[ability]).join(', ')}{' '}
              {overCapAbilities.length === 1 ? 'está' : 'estão'} em 20 ou mais — sem item mágico ou
              efeito especial, nenhuma build chega lá. Confira se não é engano.
            </p>
          )}
          <Button variant="primary" full onTap={() => setAbilitySheet(false)}>
            Pronto
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

// ===========================================================================
// Magias
// ===========================================================================

function SpellsTab({ character, derived, update }: TabProps): JSX.Element {
  const { library } = useAppData();
  const { rollCheck } = useRoller();
  const [picker, setPicker] = useState(false);
  const [detail, setDetail] = useState<{ title: string; body: string } | null>(null);

  const warlockLevel = character.classes.find((entry) => entry.classId === 'warlock')?.level ?? 0;
  const pact = warlockLevel > 0 ? pactMagic(warlockLevel) : null;
  const maxLevel = highestSlotLevel(derived.spellSlots);
  const grouped = groupSpellsByLevel(character.spellcasting.spells);
  const added = new Set(character.spellcasting.spells.map((spell) => spell.spellId));

  const isCaster = derived.spellcasting.length > 0 || derived.spellSlots.length > 0 || pact !== null;

  const castSlot = (level: number): void => {
    if (level === 0) return; // truques não gastam espaço
    const total = derived.spellSlots[level - 1] ?? 0;
    const used = character.spellcasting.slotsUsed[level - 1] ?? 0;
    if (used >= total) return;
    haptic('medium');
    update((current) => {
      const slotsUsed = [...current.spellcasting.slotsUsed];
      slotsUsed[level - 1] = used + 1;
      return { ...current, spellcasting: { ...current.spellcasting, slotsUsed } };
    });
  };

  return (
    <>
      {derived.spellcasting.map((stats) => (
        <Section key={stats.classId} title={`Conjuração — ${CLASSES[stats.classId].label}`}>
          <div className="grid grid--3">
            <StatTile label="CD de resistência" value={stats.saveDc} />
            <StatTile
              label="Ataque mágico"
              value={formatModifier(stats.attackBonus)}
              onTap={() => rollCheck('Ataque mágico', stats.attackBonus)}
            />
            <StatTile
              label="Habilidade"
              value={ABILITY_ABBREVIATIONS[stats.ability]}
              hint={
                stats.preparedCount !== null ? `${stats.preparedCount} preparadas` : 'conhecidas'
              }
              size="sm"
            />
          </div>
        </Section>
      ))}

      {derived.spellSlots.length > 0 && (
        <Section title="Espaços de magia">
          <Card>
            {derived.spellSlots.map((total, index) => {
              const level = index + 1;
              const used = character.spellcasting.slotsUsed[index] ?? 0;
              if (total === 0) return null;
              return (
                <div key={level} className="slots">
                  <span className="slots__label dfo-overline">{spellLevelLabel(level)}</span>
                  <div className="slots__pips">
                    {Array.from({ length: total }, (_, slot) => (
                      <Tappable
                        key={slot}
                        className={`pip pip--slot${slot < total - used ? ' pip--on' : ''}`}
                        ariaLabel={`Espaço ${slot + 1} de ${spellLevelLabel(level)}`}
                        onTap={() => {
                          // Tocar num espaço cheio gasta; num vazio, devolve.
                          const nextUsed = slot < total - used ? used + 1 : used - 1;
                          haptic('light');
                          update((current) => {
                            const slotsUsed = [...current.spellcasting.slotsUsed];
                            slotsUsed[index] = Math.max(0, Math.min(total, nextUsed));
                            return {
                              ...current,
                              spellcasting: { ...current.spellcasting, slotsUsed },
                            };
                          });
                        }}
                      />
                    ))}
                  </div>
                  <span className="slots__count dfo-numeric dfo-caption">
                    {total - used}/{total}
                  </span>
                </div>
              );
            })}
            {maxLevel > 0 && (
              <div className="dfo-caption">
                Maior nível disponível: {spellLevelLabel(maxLevel)}.
              </div>
            )}
          </Card>
        </Section>
      )}

      {pact && (
        <Section title="Magia de Pacto">
          <Card>
            <div className="slots">
              <span className="slots__label dfo-overline">{spellLevelLabel(pact.slotLevel)}</span>
              <div className="slots__pips">
                {Array.from({ length: pact.slots }, (_, slot) => (
                  <Tappable
                    key={slot}
                    className={`pip pip--slot${
                      slot < pact.slots - character.spellcasting.pactSlotsUsed ? ' pip--on' : ''
                    }`}
                    ariaLabel={`Espaço de pacto ${slot + 1}`}
                    onTap={() => {
                      const used = character.spellcasting.pactSlotsUsed;
                      const next = slot < pact.slots - used ? used + 1 : used - 1;
                      update((current) => ({
                        ...current,
                        spellcasting: {
                          ...current.spellcasting,
                          pactSlotsUsed: Math.max(0, Math.min(pact.slots, next)),
                        },
                      }));
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="dfo-caption">
              Volta no descanso curto — é o traço que define o bruxo.
            </div>
          </Card>
        </Section>
      )}

      <Section
        title="Grimório"
        action={
          <Tappable onTap={() => setPicker(true)} className="link-button">
            + adicionar
          </Tappable>
        }
      >
        {grouped.length === 0 && (
          <Card>
            <span className="dfo-caption">
              {isCaster
                ? 'Nenhuma magia ainda. Toque em “adicionar” para buscar no acervo.'
                : 'Esta classe não conjura. Se multiclassar para uma que conjure, os espaços aparecem aqui sozinhos.'}
            </span>
          </Card>
        )}

        {grouped.map(([level, spells]) => (
          <div key={level} className="spell-group">
            <div className="spell-group__head">
              <span className="dfo-overline">{spellLevelLabel(level)}</span>
              <span className="dfo-caption">{spells.length}</span>
            </div>
            <Card>
              <ul className="rows">
                {spells.map((spell) => (
                  <li key={spell.spellId}>
                    <div className="row">
                      <Tappable
                        className={`prof${spell.prepared || spell.level === 0 ? ' prof--proficient' : ''}`}
                        ariaLabel={`Preparar ${spell.label}`}
                        pressScale={0.85}
                        onTap={() => togglePrepared(spell)}
                      />
                      <Tappable
                        as="div"
                        className="row__tap"
                        onTap={() => void openDetail(spell)}
                      >
                        <span className="row__label">{spell.label}</span>
                      </Tappable>
                      <Tappable
                        className="spell-cast"
                        ariaLabel={`Conjurar ${spell.label}`}
                        hapticOnTap
                        onTap={() => castSlot(level)}
                      >
                        {level === 0 ? 'truque' : 'conjurar'}
                      </Tappable>
                      <Tappable
                        className="link-button"
                        ariaLabel={`Remover ${spell.label}`}
                        onTap={() => remove(spell)}
                      >
                        ×
                      </Tappable>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        ))}
      </Section>

      <Section title="Concentração">
        <Card>
          <label className="dfo-field">
            <span className="dfo-overline">Magia em concentração</span>
            <input
              type="text"
              value={character.spellcasting.concentratingOn ?? ''}
              placeholder="nenhuma"
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  spellcasting: {
                    ...current.spellcasting,
                    concentratingOn: event.target.value.trim() || null,
                  },
                }))
              }
            />
          </label>
          <div className="dfo-caption">
            Ao sofrer dano, o teste de Constituição é CD 10 ou metade do dano — o que for maior.
          </div>
        </Card>
      </Section>

      <SpellPicker
        open={picker}
        onClose={() => setPicker(false)}
        alreadyAdded={added}
        onAdd={(spell) => {
          haptic('success');
          update((current) => ({
            ...current,
            spellcasting: {
              ...current.spellcasting,
              spells: [...current.spellcasting.spells, spell],
            },
          }));
        }}
      />

      <BottomSheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.title}
        maxHeight={0.85}
      >
        {detail?.body.split('\n').map((paragraph, index) =>
          paragraph.trim() === '' ? null : (
            <p key={index} className="dfo-body entry__paragraph">
              {paragraph}
            </p>
          ),
        )}
      </BottomSheet>
    </>
  );

  function togglePrepared(spell: SpellEntry): void {
    haptic('light');
    update((current) => ({
      ...current,
      spellcasting: {
        ...current.spellcasting,
        spells: current.spellcasting.spells.map((entry) =>
          entry.spellId === spell.spellId ? { ...entry, prepared: !entry.prepared } : entry,
        ),
      },
    }));
  }

  function remove(spell: SpellEntry): void {
    update((current) => ({
      ...current,
      spellcasting: {
        ...current.spellcasting,
        spells: current.spellcasting.spells.filter((entry) => entry.spellId !== spell.spellId),
      },
    }));
  }

  async function openDetail(spell: SpellEntry): Promise<void> {
    const entry = await library.get(spell.spellId);
    setDetail({
      title: spell.label,
      body: entry?.body ?? 'Descrição indisponível — o acervo desta magia não está carregado.',
    });
  }
}

// ===========================================================================
// Bolsa
// ===========================================================================

function PouchTab({ character, derived, update }: TabProps): JSX.Element {
  const [label, setLabel] = useState('');
  const [weight, setWeight] = useState('');

  return (
    <>
      <Section title="Carga">
        <div className="grid grid--2">
          <StatTile
            label="Carregando"
            value={`${derived.carriedKg.toFixed(1)} kg`}
            hint={`de ${derived.encumbrance.capacity.capacityKg.toFixed(0)} kg`}
            tone={derived.encumbrance.level === 'overloaded' ? 'danger' : undefined}
          />
          <StatTile
            label="Situação"
            value={ENCUMBRANCE_LABELS[derived.encumbrance.level]}
            size="sm"
          />
        </div>
      </Section>

      <Section title="Moedas">
        <Card>
          <div className="coins">
            {COINS.map((coin) => (
              <label key={coin} className="coins__item">
                <span className="dfo-overline">{COIN_LABELS[coin]}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={character.purse[coin]}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      purse: {
                        ...current.purse,
                        [coin]: Math.max(0, Number(event.target.value) || 0),
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Equipamento">
        <Card>
          {character.inventory.length === 0 && (
            <span className="dfo-caption">A mochila está vazia.</span>
          )}
          <ul className="rows">
            {character.inventory.map((item) => (
              <li key={item.id}>
                <div className="row">
                  <span className="row__label">
                    {item.label}
                    {item.quantity > 1 && <span className="row__ability">×{item.quantity}</span>}
                  </span>
                  <span className="row__value dfo-caption dfo-numeric">
                    {(item.weightKg * item.quantity).toFixed(1)} kg
                  </span>
                  <Tappable
                    className="link-button"
                    ariaLabel={`Remover ${item.label}`}
                    onTap={() =>
                      update((current) => ({
                        ...current,
                        inventory: current.inventory.filter((entry) => entry.id !== item.id),
                      }))
                    }
                  >
                    ×
                  </Tappable>
                </div>
              </li>
            ))}
          </ul>

          <div className="add-item">
            <input
              type="text"
              className="dfo-input"
              value={label}
              placeholder="Corda de cânhamo, 15 m"
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addItem();
              }}
            />
            <input
              type="number"
              className="dfo-input add-item__weight"
              value={weight}
              placeholder="kg"
              inputMode="decimal"
              min={0}
              step={0.1}
              aria-label="Peso em quilos"
              onChange={(event) => setWeight(event.target.value)}
            />
          </div>
          <Button variant="secondary" full onTap={addItem} disabled={label.trim() === ''}>
            Adicionar item
          </Button>
        </Card>
      </Section>
    </>
  );

  function addItem(): void {
    if (label.trim() === '') return;
    update((current) => ({
      ...current,
      inventory: [
        ...current.inventory,
        {
          id: crypto.randomUUID(),
          label: label.trim(),
          quantity: 1,
          weightKg: Math.max(0, Number(weight.replace(',', '.')) || 0),
          equipped: false,
          srdId: null,
          description: '',
        },
      ],
    }));
    setLabel('');
    setWeight('');
  }
}

// ===========================================================================
// Perfil — inclui a progressão de nível
// ===========================================================================

function ProfileTab({ character, derived, update }: TabProps): JSX.Element {
  const [addClass, setAddClass] = useState(false);
  const nextLevelXp = xpToNextLevel(character.xp);

  const set = (field: keyof Character['personality'], value: string): void =>
    update((current) => ({ ...current, personality: { ...current.personality, [field]: value } }));

  const setClassLevel = (index: number, level: number): void =>
    update((current) => ({
      ...current,
      classes: current.classes.map((entry, i) => (i === index ? { ...entry, level } : entry)),
    }));

  const removeClass = (index: number): void =>
    update((current) => ({
      ...current,
      // Nunca remover a última: um personagem sem classe não valida no schema.
      classes: current.classes.length > 1 ? current.classes.filter((_, i) => i !== index) : current.classes,
    }));

  return (
    <>
      <Section title="Progressão">
        <Card>
          {character.classes.map((entry, index) => (
            <div key={`${entry.classId}-${index}`} className="class-row">
              <div className="class-row__head">
                <span className="dfo-headline">{CLASSES[entry.classId].label}</span>
                {character.classes.length > 1 && (
                  <Tappable
                    className="link-button"
                    ariaLabel={`Remover ${CLASSES[entry.classId].label}`}
                    onTap={() => removeClass(index)}
                  >
                    remover
                  </Tappable>
                )}
              </div>
              <Stepper
                label="Nível"
                value={entry.level}
                min={1}
                max={MAX_LEVEL}
                onChange={(level) => setClassLevel(index, level)}
              />
            </div>
          ))}

          <div className="class-row__total dfo-caption">
            Nível total <strong className="dfo-numeric">{derived.totalLevel}</strong> · bônus de
            proficiência <strong>{formatModifier(derived.proficiencyBonus)}</strong>
          </div>

          {totalLevel(character.classes) < MAX_LEVEL && (
            <Button variant="secondary" full onTap={() => setAddClass(true)}>
              + Multiclasse
            </Button>
          )}
        </Card>
      </Section>

      <Section title="Experiência">
        <Card>
          <label className="dfo-field">
            <span className="dfo-overline">XP acumulado</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={character.xp}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  xp: Math.max(0, Number(event.target.value) || 0),
                }))
              }
            />
          </label>
          <div className="dfo-caption">
            {nextLevelXp === null ? (
              'Nível máximo alcançado.'
            ) : (
              <>
                Faltam <strong className="dfo-numeric">{nextLevelXp.toLocaleString('pt-BR')}</strong>{' '}
                XP para o nível {levelForXp(character.xp) + 1}.
              </>
            )}
          </div>
          {levelForXp(character.xp) !== derived.totalLevel && (
            <div className="dfo-caption profile__warn">
              O XP corresponde ao nível {levelForXp(character.xp)}, mas a ficha está no{' '}
              {derived.totalLevel}. Ajuste o nível acima se a sua mesa usa XP.
            </div>
          )}
        </Card>
      </Section>

      <Section title="Personalidade">
        <Card>
          {(
            [
              ['traits', 'Traços de personalidade'],
              ['ideals', 'Ideais'],
              ['bonds', 'Vínculos'],
              ['flaws', 'Defeitos'],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="dfo-field">
              <span className="dfo-overline">{label}</span>
              <textarea
                value={character.personality[field]}
                onChange={(event) => set(field, event.target.value)}
              />
            </label>
          ))}
        </Card>
      </Section>

      <Section title="História e anotações">
        <Card>
          <label className="dfo-field">
            <span className="dfo-overline">História</span>
            <textarea
              value={character.identity.backstory}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  identity: { ...current.identity, backstory: event.target.value },
                }))
              }
            />
          </label>
          <label className="dfo-field">
            <span className="dfo-overline">Anotações da sessão</span>
            <textarea
              value={character.notes}
              placeholder="O que aconteceu na última sessão…"
              onChange={(event) => update((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
        </Card>
      </Section>

      <Section title="Manutenção">
        <Card>
          <Button
            variant="ghost"
            full
            onTap={() =>
              update((current) => ({
                ...current,
                deathSaves: EMPTY_DEATH_SAVES,
                conditions: [],
                exhaustion: 0,
              }))
            }
          >
            Limpar condições e testes contra a morte
          </Button>
        </Card>
      </Section>

      <BottomSheet open={addClass} onClose={() => setAddClass(false)} title="Adicionar classe">
        <div className="editor">
          <p className="dfo-caption">
            A multiclasse soma os níveis para o bônus de proficiência, mas os espaços de magia
            passam a usar a tabela combinada — o app recalcula tudo sozinho.
          </p>
          <div className="class-picker">
            {CLASS_IDS.filter(
              (id) => !character.classes.some((entry) => entry.classId === id),
            ).map((id) => (
              <Tappable
                as="div"
                key={id}
                className="class-option"
                style={classGradientVars(id)}
                hapticOnTap
                onTap={() => {
                  update((current) => ({
                    ...current,
                    classes: [...current.classes, { classId: id as ClassId, level: 1 }],
                  }));
                  setAddClass(false);
                }}
              >
                <span className="class-option__name">{CLASSES[id].label}</span>
                <span className="class-option__die">d{CLASSES[id].hitDie}</span>
              </Tappable>
            ))}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
