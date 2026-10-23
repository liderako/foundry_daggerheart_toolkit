import { MODULE_ID } from "./shared.js";
import { LOAD_RULES_HOOK, getEncumbrance } from "./weight.js";

const OVERLOAD_FLAG = `flags.${MODULE_ID}.overload`;
const DEFAULT_ICON = "icons/svg/anchor.svg";
const pending = new Map();

/**
 * Marks an overloaded character with an icon-only active effect (no changes), shown on its token and sheet.
 * The overloadEffect setting turns it off or limits it to heavy overload. Called during init.
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
	game.settings.register(MODULE_ID, "overloadIcon", {
		name: "MIST_AGE_WEIGHT.OverloadIcon.Name",
		hint: "MIST_AGE_WEIGHT.OverloadIcon.Hint",
		scope: "world",
		config: false,
		type: String,
		default: DEFAULT_ICON,
		filePicker: "image",
		onChange: syncAllCharacters
	});

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

async function syncOverloadEffect(actor) {
	const mode = game.settings.get(MODULE_ID, "overloadEffect");
	const { state, overload } = getEncumbrance(actor);
	const overloaded = mode === "heavy" ? state === "heavy" : state !== "ok";
	const show = mode !== "off" && overloaded && !game.itempiles?.API.isValidItemPile(actor);
	const [current, ...extra] = actor.effects.filter(effect => foundry.utils.getProperty(effect, OVERLOAD_FLAG));
	const stale = show ? extra : [current, ...extra].filter(Boolean);
	if (stale.length) {
		await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map(effect => effect.id));
	}
	if (!show) {
		return;
	}
	const label = game.i18n.localize(state === "heavy" ? "MIST_AGE_WEIGHT.HeavilyOverloaded" : "MIST_AGE_WEIGHT.Overloaded");
	const name = `${label} (+${overload})`;
	const img = game.settings.get(MODULE_ID, "overloadIcon") || DEFAULT_ICON;
	if (!current) {
		await actor.createEmbeddedDocuments("ActiveEffect", [{
			name,
			img,
			showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
			flags: { [MODULE_ID]: { overload: true } }
		}]);
	} else if (current.name !== name || current.img !== img) {
		await current.update({ name, img });
	}
}
