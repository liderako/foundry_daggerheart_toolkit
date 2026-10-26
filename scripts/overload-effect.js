import { MODULE_ID } from "./shared.js";
import { LOAD_RULES_HOOK, getEncumbrance } from "./weight.js";

const OVERLOAD_FLAG = `flags.${MODULE_ID}.overload`;
const DEFAULT_ICONS = { light: "icons/svg/anchor.svg", heavy: "icons/svg/downgrade.svg" };
const ICON_SETTINGS = { light: "overloadIcon", heavy: "overloadHeavyIcon" };
const EFFECT_SETTINGS = { light: "overloadLightEffect", heavy: "overloadHeavyEffect" };
const LABELS = { light: "MIST_AGE_WEIGHT.Overloaded", heavy: "MIST_AGE_WEIGHT.HeavilyOverloaded" };
// Ids of the effects opened in the Daggerheart effect sheet; effect ids are 16 letters or digits.
const EDITOR_IDS = { light: "mistAgeOverLight", heavy: "mistAgeOverHeavy" };
// Earlier versions kept the penalties elsewhere: 1.0.8 as a list of changes, 1.0.7 as one number per stat.
const LEGACY_CHANGE_SETTINGS = { light: "overloadLightChanges", heavy: "overloadHeavyChanges" };
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
const pending = new Map();
let editorClass;

/**
 * Marks an overloaded character with an active effect on its token and sheet, one look for light overload (over
 * capacity, within the light overload limit) and another for heavy overload. What each state does to the character is
 * an effect edited in the Daggerheart effect sheet (changes and conditionals) from the toolkit settings, and stored
 * in a setting. The overloadEffect setting turns the effect off or limits it to heavy overload. Called during init.
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
		const name = level === "light" ? "OverloadLightEffect" : "OverloadHeavyEffect";
		game.settings.register(MODULE_ID, EFFECT_SETTINGS[level], {
			name: `MIST_AGE_WEIGHT.${name}.Name`,
			hint: `MIST_AGE_WEIGHT.${name}.Hint`,
			scope: "world",
			config: false,
			type: Object,
			default: {},
			// Read by the toolkit settings window, which opens the effect sheet instead of an input.
			editEffect: () => editOverloadEffect(level),
			onChange: syncAllCharacters
		});
		game.settings.register(MODULE_ID, LEGACY_CHANGE_SETTINGS[level], { scope: "world", config: false, type: Array, default: [] });
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

/** The effect data an overload state applies: its system data (changes, conditionals) as saved from the sheet. */
function getEffectSystem(level) {
	const system = game.settings.get(MODULE_ID, EFFECT_SETTINGS[level])?.system ?? {};
	return { ...system, changes: Array.isArray(system.changes) ? system.changes : [] };
}

/** Opens the Daggerheart effect sheet on an overload state's effect, showing only its changes and conditionals. */
export async function editOverloadEffect(level) {
	const Config = game.system.api?.applications?.sheetConfigs?.ActiveEffectConfig;
	if (!Config?.configureSetting) {
		ui.notifications.warn(game.i18n.localize("MIST_AGE_WEIGHT.EffectEditorMissing"));
		return;
	}
	editorClass ??= class OverloadEffectConfig extends Config {
		static PARTS = Object.fromEntries(Object.entries(Config.PARTS).filter(([id]) => !["details", "settings"].includes(id)));

		static TABS = {
			...Config.TABS,
			sheet: { ...Config.TABS.sheet, tabs: Config.TABS.sheet.tabs.filter(tab => ["conditionals", "changes"].includes(tab.id)), initial: "changes" }
		};
	};
	const effect = await editorClass.configureSetting({
		id: EDITOR_IDS[level],
		name: game.i18n.localize(LABELS[level]),
		img: game.settings.get(MODULE_ID, ICON_SETTINGS[level]) || DEFAULT_ICONS[level],
		system: getEffectSystem(level)
	});
	if (effect?.system) {
		await game.settings.set(MODULE_ID, EFFECT_SETTINGS[level], { system: effect.system });
	}
}

/** Moves the penalties of versions 1.0.7 and 1.0.8 into the effect settings, then clears them. */
async function migrateLegacyPenalties() {
	if (!game.user.isGM) {
		return;
	}
	for (const level of ["light", "heavy"]) {
		const listed = (game.settings.get(MODULE_ID, LEGACY_CHANGE_SETTINGS[level]) ?? []).filter(change => change?.key);
		const perStat = Object.entries(game.settings.get(MODULE_ID, LEGACY_PENALTY_SETTINGS[level]) ?? {})
			.filter(([stat, value]) => LEGACY_PENALTY_PATHS[stat] && Number(value))
			.map(([stat, value]) => ({ key: LEGACY_PENALTY_PATHS[stat], type: "add", value: String(value), priority: null }));
		const moved = [...listed, ...perStat].map(({ key, type, value, priority }) => ({
			key,
			type: type || "add",
			value: String(value ?? ""),
			phase: "initial",
			...(Number.isFinite(priority) ? { priority } : {})
		}));
		if (!moved.length) {
			continue;
		}
		const system = getEffectSystem(level);
		await game.settings.set(MODULE_ID, EFFECT_SETTINGS[level], { system: { ...system, changes: [...system.changes, ...moved] } });
		await game.settings.set(MODULE_ID, LEGACY_CHANGE_SETTINGS[level], []);
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
	const system = getEffectSystem(level);
	const name = `${game.i18n.localize(LABELS[level])} (+${overload})`;
	const img = game.settings.get(MODULE_ID, ICON_SETTINGS[level]) || DEFAULT_ICONS[level];
	// Compared through a flag, since the effect's own system data gains defaults once stored.
	const signature = JSON.stringify(system);
	// The description of version 1.0.7 listed the penalties; the changes now show in the effect's Changes tab.
	const data = { name, img, description: "", system, [`flags.${MODULE_ID}.overloadChanges`]: signature };
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
