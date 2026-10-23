import { MODULE_ID } from "./shared.js";
import { LOAD_RULES_HOOK, getEncumbrance } from "./weight.js";

const OVERLOAD_FLAG = `flags.${MODULE_ID}.overload`;
const DEFAULT_ICONS = { light: "icons/svg/anchor.svg", heavy: "icons/svg/downgrade.svg" };
const ICON_SETTINGS = { light: "overloadIcon", heavy: "overloadHeavyIcon" };
const PENALTY_SETTINGS = { light: "overloadLightPenalties", heavy: "overloadHeavyPenalties" };
const LABELS = { light: "MIST_AGE_WEIGHT.Overloaded", heavy: "MIST_AGE_WEIGHT.HeavilyOverloaded" };

/** Character stats an overload penalty can lower, as Daggerheart effect paths. Labels come from Daggerheart where it has them. */
export const PENALTY_STATS = [
	{ key: "evasion", path: "system.evasion", label: "DAGGERHEART.GENERAL.evasion" },
	...["agility", "strength", "finesse", "instinct", "presence", "knowledge"].map(trait => ({
		key: trait,
		path: `system.traits.${trait}.value`,
		label: `DAGGERHEART.CONFIG.Traits.${trait}.name`
	})),
	{ key: "proficiency", path: "system.proficiency", label: "DAGGERHEART.GENERAL.proficiency" },
	{ key: "majorThreshold", path: "system.damageThresholds.major", label: "DAGGERHEART.GENERAL.DamageThresholds.majorThreshold" },
	{ key: "severeThreshold", path: "system.damageThresholds.severe", label: "DAGGERHEART.GENERAL.DamageThresholds.severeThreshold" },
	{ key: "hitPoints", path: "system.resources.hitPoints.max", label: "MIST_AGE_WEIGHT.Stats.HitPoints" },
	{ key: "stress", path: "system.resources.stress.max", label: "MIST_AGE_WEIGHT.Stats.Stress" },
	{ key: "hope", path: "system.resources.hope.max", label: "MIST_AGE_WEIGHT.Stats.Hope" }
];
const pending = new Map();

/**
 * Marks an overloaded character with an active effect on its token and sheet, one look for light overload (over
 * capacity, within the light overload limit) and another for heavy overload. The effect carries the stat penalties
 * set for that state. The overloadEffect setting turns it off or limits it to heavy overload. Called during init.
 */
export function registerOverloadEffect() {
	game.settings.register(MODULE_ID, "overloadEffect", {
		name: "MIST_AGE_WEIGHT.OverloadEffect.Name",
		hint: "MIST_AGE_WEIGHT.OverloadEffect.Hint",
		scope: "world",
		config: false,
		type: String,
		choices: {
			off: "MIST_AGE_WEIGHT.OverloadEffect.Off",
			any: "MIST_AGE_WEIGHT.OverloadEffect.Any",
			heavy: "MIST_AGE_WEIGHT.OverloadEffect.Heavy"
		},
		default: "any",
		onChange: syncAllCharacters
	});
	for (const level of ["light", "heavy"]) {
		const name = level === "light" ? "OverloadIcon" : "OverloadHeavyIcon";
		game.settings.register(MODULE_ID, ICON_SETTINGS[level], {
			name: `MIST_AGE_WEIGHT.${name}.Name`,
			hint: `MIST_AGE_WEIGHT.${name}.Hint`,
			scope: "world",
			config: false,
			type: String,
			default: DEFAULT_ICONS[level],
			filePicker: "image",
			onChange: syncAllCharacters
		});
	}
	for (const level of ["light", "heavy"]) {
		const name = level === "light" ? "OverloadLightPenalties" : "OverloadHeavyPenalties";
		game.settings.register(MODULE_ID, PENALTY_SETTINGS[level], {
			name: `MIST_AGE_WEIGHT.${name}.Name`,
			hint: `MIST_AGE_WEIGHT.${name}.Hint`,
			scope: "world",
			config: false,
			type: Object,
			default: {},
			// Read by the toolkit settings window, which shows one number field per stat.
			stats: PENALTY_STATS,
			onChange: syncAllCharacters
		});
	}

	for (const hook of ["createItem", "updateItem", "deleteItem"]) {
		Hooks.on(hook, item => queueSync(item.parent));
	}
	Hooks.on("updateActor", actor => queueSync(actor));
	// Effects can change Strength or bonusSlots, on the actor or through its items; our own marker is skipped.
	for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
		Hooks.on(hook, effect => {
			if (foundry.utils.getProperty(effect, OVERLOAD_FLAG)) {
				return;
			}
			queueSync(effect.parent?.documentName === "Actor" ? effect.parent : effect.parent?.parent);
		});
	}
	Hooks.on(LOAD_RULES_HOOK, syncAllCharacters);
	Hooks.once("ready", syncAllCharacters);
}

function syncAllCharacters() {
	// Preset weights can finish loading before the world is ready; the ready hook syncs then.
	if (!game.ready) {
		return;
	}
	for (const actor of game.actors.filter(a => a.type === "character")) {
		queueSync(actor);
	}
}

/** Runs on the active GM only, once per burst of changes to the same character. */
function queueSync(actor) {
	if (actor?.type !== "character" || !game.users.activeGM?.isSelf) {
		return;
	}
	clearTimeout(pending.get(actor.uuid));
	pending.set(actor.uuid, setTimeout(() => {
		pending.delete(actor.uuid);
		syncOverloadEffect(actor);
	}, 50));
}

/** The stat changes of an overload state, from its penalty setting; zero penalties are left out. */
function getPenaltyChanges(level) {
	const penalties = game.settings.get(MODULE_ID, PENALTY_SETTINGS[level]) ?? {};
	return PENALTY_STATS
		.filter(stat => Number(penalties[stat.key]))
		.map(stat => ({ key: stat.path, value: Number(penalties[stat.key]), label: stat.label }));
}

/** Effect data for the changes, in the shape this Foundry version stores: system.changes from v14, changes before. */
function changeData(changes) {
	if (game.release.generation >= 14) {
		return { system: { changes: changes.map(({ key, value }) => ({ key, type: "add", value: String(value) })) } };
	}
	return { changes: changes.map(({ key, value }) => ({ key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(value) })) };
}

function describe(changes) {
	return changes.map(({ label, value }) => `${game.i18n.localize(label)} ${value > 0 ? "+" : ""}${value}`).join(", ");
}

async function syncOverloadEffect(actor) {
	const mode = game.settings.get(MODULE_ID, "overloadEffect");
	const { state, overload } = getEncumbrance(actor);
	const level = state === "heavy" ? "heavy" : state === "overloaded" && mode === "any" ? "light" : null;
	const show = mode !== "off" && level && !game.itempiles?.API.isValidItemPile(actor);
	const [current, ...extra] = actor.effects.filter(effect => foundry.utils.getProperty(effect, OVERLOAD_FLAG));
	const stale = show ? extra : [current, ...extra].filter(Boolean);
	if (stale.length) {
		await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map(effect => effect.id));
	}
	if (!show) {
		return;
	}
	const changes = getPenaltyChanges(level);
	const name = `${game.i18n.localize(LABELS[level])} (+${overload})`;
	const img = game.settings.get(MODULE_ID, ICON_SETTINGS[level]) || DEFAULT_ICONS[level];
	const description = describe(changes);
	// Compared through a flag, since the stored shape of changes differs between Foundry versions.
	const signature = JSON.stringify(changes.map(({ key, value }) => [key, value]));
	const data = { name, img, description, [`flags.${MODULE_ID}.overloadChanges`]: signature, ...changeData(changes) };
	if (!current) {
		await actor.createEmbeddedDocuments("ActiveEffect", [foundry.utils.mergeObject({
			showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
			flags: { [MODULE_ID]: { overload: true } }
		}, foundry.utils.expandObject(data))]);
	} else if (current.name !== name || current.img !== img || current.description !== description
		|| foundry.utils.getProperty(current, `flags.${MODULE_ID}.overloadChanges`) !== signature) {
		await current.update(data);
	}
}
