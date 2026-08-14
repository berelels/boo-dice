import { useState } from 'react';
import {
  ABILITIES,
  ABILITY_ABBREVIATIONS,
  ABILITY_LABELS,
  CLASSES,
  COINS,
  COIN_LABELS,
  CONDITION_DEFINITIONS,
  ENCUMBRANCE_LABELS,
  SKILL_DEFINITIONS,
  classSummary,
  concentrationSaveDc,
  deriveCharacter,
  exhaustionEffects,
  formatModifier,
  highestSlotLevel,
  levelForXp,
  primaryClassId,
  spellLevelLabel,
  xpToNextLevel,
  type Character,
  type DerivedCharacter,
  type SpellEntry,
} from '@dfo/core';
import { BottomSheet, Chip, HeroCard, Section, StatTile } from '@dfo/ui';

type Tab = 'combate' | 'testes' | 'magias' | 'bolsa' | 'perfil';

const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'combate', label: 'Combate' },
  { value: 'testes', label: 'Testes' },
  { value: 'magias', label: 'Magias' },
  { value: 'bolsa', label: 'Bolsa' },
  { value: 'perfil', label: 'Perfil' },
];

/**
 * Ficha completa de um jogador, somente leitura — o Mestre olha, não edita.
 *
 * Mesma estrutura de abas da ficha do jogador
 * ([Sheet.tsx](../../../../../player/src/screens/Sheet.tsx)), mas sem nenhuma
 * interação de edição, rolagem ou formulário: é reaproveitar `deriveCharacter`
 * e os tipos de `@dfo/core` pra mostrar os mesmos números, não duplicar a
 * lógica de regras.
 */
export function PlayerSheet({
  playerName,
  character,
  onClose,
}: {
  playerName: string | null;
  character: Character | null;
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('combate');
  const derived = character ? deriveCharacter(character) : null;

  return (
    <BottomSheet open={character !== null} onClose={onClose} title={character?.name} maxHeight={0.94}>
      {character && derived && (
        <div className="player-sheet">
          <HeroCard
            compact
            accent={primaryClassId(character)}
            eyebrow={classSummary(character)}
            title={character.name}
            subtitle={[character.identity.raceLabel, playerName ? `jogador ${playerName}` : null]
              .filter(Boolean)
              .join(' · ')}
            portrait={character.portraitDataUrl}
            level={character.portraitDataUrl ? undefined : derived.totalLevel}
          />

          <div className="player-sheet__tabs">
            {TABS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={`chip-button${tab === entry.value ? ' is-active' : ''}`}
                onClick={() => setTab(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tab === 'combate' && <CombatView character={character} derived={derived} />}
          {tab === 'testes' && <ChecksView character={character} derived={derived} />}
          {tab === 'magias' && <SpellsView character={character} derived={derived} />}
          {tab === 'bolsa' && <PouchView character={character} derived={derived} />}
          {tab === 'perfil' && <ProfileView character={character} />}
        </div>
      )}
    </BottomSheet>
  );
}

interface ViewProps {
  readonly character: Character;
  readonly derived: DerivedCharacter;
}

// ===========================================================================
// Combate
// ===========================================================================

function CombatView({ character, derived }: ViewProps): JSX.Element {
  const hpRatio = character.hitPoints.max > 0 ? character.hitPoints.current / character.hitPoints.max : 0;
  const downed = character.hitPoints.current === 0;

  return (
    <>
      <Section title="Vitalidade">
        <div className="player-sheet__vitals">
          <div className="player-sheet__hp-head">
            <span className="dfo-overline">Pontos de vida</span>
            {character.hitPoints.temporary > 0 && <Chip tone="success">+{character.hitPoints.temporary} temp</Chip>}
          </div>
          <div className={`player-sheet__hp-value dfo-numeric${downed ? ' is-down' : ''}`}>
            {character.hitPoints.current}
            <span className="stat__of">/{character.hitPoints.max}</span>
          </div>
          <div className="vitals__bar" role="presentation">
            <div
              className={`vitals__bar-fill${hpRatio <= 0.25 ? ' is-critical' : ''}`}
              style={{ width: `${Math.max(0, Math.min(1, hpRatio)) * 100}%` }}
            />
          </div>

          <div className="grid-3">
            <StatTile label="CA" value={derived.armorClass.total} />
            <StatTile label="Iniciativa" value={formatModifier(derived.initiative)} />
            <StatTile label="Deslocamento" value={`${character.speedMeters}`} hint="metros" />
          </div>
          <div className="grid-3">
            <StatTile label="Percepção passiva" value={derived.passivePerception} size="sm" />
            <StatTile label="Investigação" value={derived.passiveInvestigation} size="sm" />
            <StatTile
              label="Inspiração"
              value={character.inspiration ? '✦' : '—'}
              size="sm"
              tone={character.inspiration ? 'accent' : undefined}
            />
          </div>
        </div>
      </Section>

      {downed && (
        <Section title="Testes contra a morte">
          <div className="player-sheet__death">
            <div>
              <span className="dfo-overline">Sucessos</span>
              <div className="player-sheet__pips">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`pip${i < character.deathSaves.successes ? ' pip--on pip--success' : ''}`} />
                ))}
              </div>
            </div>
            <div>
              <span className="dfo-overline">Falhas</span>
              <div className="player-sheet__pips">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`pip${i < character.deathSaves.failures ? ' pip--on pip--failure' : ''}`} />
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="Dados de vida">
        <div className="player-sheet__row-list">
          {derived.hitDice.map((pool) => (
            <div key={pool.die} className="player-sheet__row">
              <span className="dfo-body">d{pool.die}</span>
              <span className="dfo-numeric">
                {pool.available}
                <span className="stat__of">/{pool.total}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Condições">
        <div className="player-sheet__chips">
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
          <div className="player-sheet__concentration">
            <Chip tone="accent">Concentrando em {character.spellcasting.concentratingOn}</Chip>
            <span className="dfo-caption">
              CD de resistência ao sofrer dano: {concentrationSaveDc(0)} ou metade do dano, o que for maior.
            </span>
          </div>
        )}
      </Section>

      <Section title="Ataques">
        {derived.attacks.length === 0 && <span className="dfo-caption">Nenhum ataque cadastrado.</span>}
        <div className="player-sheet__row-list">
          {derived.attacks.map((entry) => (
            <div key={entry.attack.id} className="player-sheet__row">
              <span className="dfo-body">{entry.attack.label}</span>
              <span className="dfo-caption">
                {formatModifier(entry.attackBonus)} · {entry.damageNotation}
                {entry.attack.damageType ? ` ${entry.attack.damageType}` : ''}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ===========================================================================
// Testes
// ===========================================================================

function ChecksView({ character, derived }: ViewProps): JSX.Element {
  return (
    <>
      <Section title="Atributos">
        <div className="grid-3">
          {ABILITIES.map((ability) => (
            <StatTile
              key={ability}
              label={ABILITY_LABELS[ability]}
              value={formatModifier(derived.abilityModifiers[ability])}
              hint={String(character.abilities[ability])}
            />
          ))}
        </div>
      </Section>

      <Section title="Testes de resistência">
        <div className="player-sheet__row-list">
          {derived.savingThrows.map((save) => (
            <div key={save.ability} className="player-sheet__row">
              <span className="dfo-body">
                {ABILITY_LABELS[save.ability]}
                {save.proficiency === 'proficient' && <Chip tone="accent">proficiente</Chip>}
              </span>
              <span className="dfo-numeric">{formatModifier(save.modifier)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Perícias">
        <div className="player-sheet__row-list">
          {[...derived.skills]
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
            .map((skill) => (
              <div key={skill.skill} className="player-sheet__row">
                <span className="dfo-body">
                  {skill.label}
                  <span className="dfo-caption"> {ABILITY_ABBREVIATIONS[SKILL_DEFINITIONS[skill.skill].ability]}</span>
                  {skill.proficiency !== 'none' && (
                    <Chip tone={skill.proficiency === 'expertise' ? 'accent' : 'neutral'}>
                      {skill.proficiency === 'expertise'
                        ? 'especialista'
                        : skill.proficiency === 'half'
                          ? 'meia'
                          : 'proficiente'}
                    </Chip>
                  )}
                </span>
                <span className="dfo-numeric">{formatModifier(skill.modifier)}</span>
              </div>
            ))}
        </div>
      </Section>
    </>
  );
}

// ===========================================================================
// Magias
// ===========================================================================

function SpellsView({ character, derived }: ViewProps): JSX.Element {
  const maxLevel = highestSlotLevel(derived.spellSlots);
  const grouped = groupSpellsByLevel(character.spellcasting.spells);
  const isCaster = derived.spellcasting.length > 0 || derived.spellSlots.length > 0 || derived.pactMagic !== null;

  if (!isCaster && grouped.length === 0) {
    return <span className="dfo-caption">Esta ficha não conjura magias.</span>;
  }

  return (
    <>
      {derived.spellcasting.map((stats) => (
        <Section key={stats.classId} title={`Conjuração — ${CLASSES[stats.classId].label}`}>
          <div className="grid-3">
            <StatTile label="CD de resistência" value={stats.saveDc} />
            <StatTile label="Ataque mágico" value={formatModifier(stats.attackBonus)} />
            <StatTile
              label="Habilidade"
              value={ABILITY_ABBREVIATIONS[stats.ability]}
              hint={stats.preparedCount !== null ? `${stats.preparedCount} preparadas` : 'conhecidas'}
              size="sm"
            />
          </div>
        </Section>
      ))}

      {derived.spellSlots.length > 0 && (
        <Section title="Espaços de magia">
          <div className="player-sheet__row-list">
            {derived.spellSlots.map((total, index) => {
              const level = index + 1;
              const used = character.spellcasting.slotsUsed[index] ?? 0;
              if (total === 0) return null;
              return (
                <div key={level} className="player-sheet__row">
                  <span className="dfo-body">{spellLevelLabel(level)}</span>
                  <span className="dfo-numeric">
                    {total - used}
                    <span className="stat__of">/{total}</span>
                  </span>
                </div>
              );
            })}
          </div>
          {maxLevel > 0 && <div className="dfo-caption">Maior nível disponível: {spellLevelLabel(maxLevel)}.</div>}
        </Section>
      )}

      {derived.pactMagic && (
        <Section title="Magia de Pacto">
          <div className="player-sheet__row">
            <span className="dfo-body">{spellLevelLabel(derived.pactMagic.slotLevel)}</span>
            <span className="dfo-numeric">
              {derived.pactMagic.slots - character.spellcasting.pactSlotsUsed}
              <span className="stat__of">/{derived.pactMagic.slots}</span>
            </span>
          </div>
        </Section>
      )}

      <Section title="Grimório">
        {grouped.length === 0 && <span className="dfo-caption">Nenhuma magia cadastrada.</span>}
        {grouped.map(([level, spells]) => (
          <div key={level} className="player-sheet__spell-group">
            <span className="dfo-overline">{spellLevelLabel(level)}</span>
            <div className="player-sheet__row-list">
              {spells.map((spell) => (
                <div key={spell.spellId} className="player-sheet__row">
                  <span className="dfo-body">{spell.label}</span>
                  {(spell.prepared || spell.level === 0) && <Chip tone="accent">preparada</Chip>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {character.spellcasting.concentratingOn && (
        <Section title="Concentração">
          <Chip tone="accent">{character.spellcasting.concentratingOn}</Chip>
        </Section>
      )}
    </>
  );
}

function groupSpellsByLevel(spells: readonly SpellEntry[]): [number, SpellEntry[]][] {
  const groups = new Map<number, SpellEntry[]>();
  for (const spell of spells) {
    const list = groups.get(spell.level);
    if (list) list.push(spell);
    else groups.set(spell.level, [spell]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, list]) => [level, [...list].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))]);
}

// ===========================================================================
// Bolsa
// ===========================================================================

function PouchView({ character, derived }: ViewProps): JSX.Element {
  return (
    <>
      <Section title="Carga">
        <div className="grid-2">
          <StatTile
            label="Carregando"
            value={`${derived.carriedKg.toFixed(1)} kg`}
            hint={`de ${derived.encumbrance.capacity.capacityKg.toFixed(0)} kg`}
            tone={derived.encumbrance.level === 'overloaded' ? 'danger' : undefined}
          />
          <StatTile label="Situação" value={ENCUMBRANCE_LABELS[derived.encumbrance.level]} size="sm" />
        </div>
      </Section>

      <Section title="Moedas">
        <div className="player-sheet__coins">
          {COINS.map((coin) => (
            <div key={coin} className="player-sheet__coin">
              <span className="dfo-overline">{COIN_LABELS[coin]}</span>
              <span className="dfo-numeric">{character.purse[coin]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Equipamento">
        {character.inventory.length === 0 && <span className="dfo-caption">A mochila está vazia.</span>}
        <div className="player-sheet__row-list">
          {character.inventory.map((item) => (
            <div key={item.id} className="player-sheet__row">
              <span className="dfo-body">
                {item.label}
                {item.quantity > 1 && <span className="dfo-caption"> ×{item.quantity}</span>}
              </span>
              <span className="dfo-caption dfo-numeric">{(item.weightKg * item.quantity).toFixed(1)} kg</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ===========================================================================
// Perfil
// ===========================================================================

function ProfileView({ character }: { character: Character }): JSX.Element {
  const nextLevelXp = xpToNextLevel(character.xp);

  return (
    <>
      <Section title="Progressão">
        <div className="player-sheet__row-list">
          {character.classes.map((entry, index) => (
            <div key={`${entry.classId}-${index}`} className="player-sheet__row">
              <span className="dfo-body">{CLASSES[entry.classId].label}</span>
              <span className="dfo-numeric">nível {entry.level}</span>
            </div>
          ))}
        </div>
        <div className="dfo-caption">
          {character.xp.toLocaleString('pt-BR')} XP
          {nextLevelXp !== null &&
            ` · faltam ${nextLevelXp.toLocaleString('pt-BR')} para o nível ${levelForXp(character.xp) + 1}`}
        </div>
      </Section>

      <Section title="Identidade">
        <div className="player-sheet__row-list">
          {character.identity.background && (
            <div className="player-sheet__row">
              <span className="dfo-caption">Antecedente</span>
              <span className="dfo-body">{character.identity.background}</span>
            </div>
          )}
          {character.identity.alignment && (
            <div className="player-sheet__row">
              <span className="dfo-caption">Tendência</span>
              <span className="dfo-body">{character.identity.alignment}</span>
            </div>
          )}
        </div>
      </Section>

      {(character.personality.traits ||
        character.personality.ideals ||
        character.personality.bonds ||
        character.personality.flaws) && (
        <Section title="Personalidade">
          <div className="player-sheet__prose">
            {character.personality.traits && <ProseField label="Traços" value={character.personality.traits} />}
            {character.personality.ideals && <ProseField label="Ideais" value={character.personality.ideals} />}
            {character.personality.bonds && <ProseField label="Vínculos" value={character.personality.bonds} />}
            {character.personality.flaws && <ProseField label="Defeitos" value={character.personality.flaws} />}
          </div>
        </Section>
      )}

      {character.identity.backstory && (
        <Section title="História">
          <p className="dfo-body player-sheet__paragraph">{character.identity.backstory}</p>
        </Section>
      )}

      {character.notes && (
        <Section title="Anotações de sessão">
          <p className="dfo-body player-sheet__paragraph">{character.notes}</p>
        </Section>
      )}
    </>
  );
}

function ProseField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="player-sheet__prose-field">
      <span className="dfo-overline">{label}</span>
      <p className="dfo-body">{value}</p>
    </div>
  );
}
