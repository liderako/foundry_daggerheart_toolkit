import { MODULE_ID } from "./shared.js";
import { LOAD_RULES_HOOK, getEncumbrance } from "./weight.js";

const OVERLOAD_FLAG = `flags.${MODULE_ID}.overload`;
const DEFAULT_ICONS = { light: "icons/svg/anchor.svg", heavy: "icons/svg/downgrade.svg" };
const ICON_SETTINGS = { light: "overloadIcon", heavy: "overloadHeavyIcon" };
const CHANGE_SETTINGS = { light: "overloadLightChanges", heavy: "overloadHeavyChanges" };
const LABELS = { light: "MIST_AGE_WEIGHT.Overloaded", heavy: "MIST_AGE_WEIGHT.HeavilyOverloaded" };
// Version 1.0.7 kept one number per stat; those penalties move into the change lists once.
const LEGACY_PENALTY_SETTINGS = { light: "overloadLightPenalties", heavy: "overloadHeavyPenalties" };
const LEGACY_PENALTY_PATHS = {
	evasion: "system.evasion",
	agility: "system.traits.agility.value",
	strength: "system.traits.strength.value",
	finesse: "system.traits.finesse.value",
	instinct: "system.traits.instinct.value",
	presence: "system.traits.presence.value",
	knowledge: "system.traits.knowledge.value",
	proficiency: "system.proficiency",
	majorThreshold: "system.damageThresholds.major",
	severeThreshold: "system.damageThresholds.severe",
	hitPoints: "system.resources.hitPoints.max",
	stress: "system.resources.stress.max",
	hope: "system.resources.hope.max"
};
// Change modes of Foundry before v14, which stored a number instead of a change type.
const LEGACY_MODES = { custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 };
const pending = new Map();

/**
 * Marks an overloaded character with an active effect on its token and sheet, one look for light overload (over
 * capacity, within the light overload limit) and another for heavy overload. Each state carries its own list of
 * effect changes, edited in the toolkit settings like the Changes tab of an effect. The overloadEffect setting turns
 * the effect off or limits it to heavy overload. Called during init.
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
		const name = level === "light" ? "OverloadLightChanges" : "OverloadHeavyChanges";
		game.settings.register(MODULE_ID, CHANGE_SETTINGS[level], {
			name: `MIST_AGE_WEIGHT.${name}.Name`,
			hint: `MIST_AGE_WEIGHT.${name}.Hint`,
			scope: "world",
			config: false,
			type: Array,
			default: [],
			// Read by the toolkit settings window, which edits the list like the Changes tab of an effect.
			changes: true,
			onChange: syncAllCharacters
		});
		game.settings.register(MODULE_ID, LEGACY_PENALTY_SETTINGS[level], { scope: "world", config: false, type: Object, default: {} });
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
	Hooks.once("ready", async () => {
		await migrateLegacyPenalties();
		syncAllCharacters();
	});
}

/** Moves the per-stat penalties of version 1.0.7 into the change lists, then clears them. */
async function migrateLegacyPenalties() {
	if (!game.user.isGM) {
		return;
	}
	for (const level of ["light", "heavy"]) {
		const penalties = Object.entries(game.settings.get(MODULE_ID, LEGACY_PENALTY_SETTINGS[level]) ?? {})
			.filter(([stat, value]) => LEGACY_PENALTY_PATHS[stat] && Number(value));
		if (!penalties.length) {
			continue;
		}
		const moved = penalties.map(([stat, value]) => ({ key: LEGACY_PENALTY_PATHS[stat], type: "add", value: String(value), priority: null }));
		await game.settings.set(MODULE_ID, CHANGE_SETTINGS[level], [...getChanges(level), ...moved]);
		await game.settings.set(MODULE_ID, LEGACY_PENALTY_SETTINGS[level], {});
	}
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

/** The changes of an overload state, without rows that have no attribute key. */
function getChanges(level) {
	const changes = game.settings.get(MODULE_ID, CHANGE_SETTINGS[level]);
	return (Array.isArray(changes) ? changes : []).filter(change => change?.key);
}

/** Effect data for the changes, in the shape this Foundry version stores: system.changes from v14, changes before. */
function changeData(changes) {
	const priority = change => (Number.isFinite(change.priority) ? { priority: change.priority } : {});
	if (game.release.generation >= 14) {
		return { system: { changes: changes.map(change => ({ key: change.key, type: change.type, value: String(change.value ?? ""), ...priority(change) })) } };
	}
	return {
		changes: changes.map(change => ({
			key: change.key,
			mode: LEGACY_MODES[change.type] ?? LEGACY_MODES.add,
			value: String(change.value ?? ""),
			...priority(change)
		}))
	};
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
	const changes = getChanges(level);
	const name = `${game.i18n.localize(LABELS[level])} (+${overload})`;
	const img = game.settings.get(MODULE_ID, ICON_SETTINGS[level]) || DEFAULT_ICONS[level];
	// Compared through a flag, since the stored shape of changes differs between Foundry versions.
	const signature = JSON.stringify(changes.map(({ key, type, value, priority }) => [key, type, String(value ?? ""), priority ?? null]));
	// The description of version 1.0.7 listed the penalties; the changes now show in the effect's Changes tab.
	const data = { name, img, description: "", [`flags.${MODULE_ID}.overloadChanges`]: signature, ...changeData(changes) };
	if (!current) {
		await actor.createEmbeddedDocuments("ActiveEffect", [foundry.utils.mergeObject({
			showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
			flags: { [MODULE_ID]: { overload: true } }
		}, foundry.utils.expandObject(data))]);
	} else if (current.name !== name || current.img !== img || current.description
		|| foundry.utils.getProperty(current, `flags.${MODULE_ID}.overloadChanges`) !== signature) {
		await current.update(data);
	}
}
