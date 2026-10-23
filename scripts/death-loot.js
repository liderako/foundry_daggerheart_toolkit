import { INVENTORY_TYPES, MODULE_ID } from "./shared.js";

const DOWN_STATUSES = ["dead", "defeated"];
const DEATH_LOOT_FLAG = `flags.${MODULE_ID}.deathLoot`;
// Overrides the world's Default Item Pile settings: the body stays on the map with its own image and name.
const BODY_PILE_SETTINGS = { type: "pile", deleteWhenEmpty: false, displayOne: false, showItemName: false, overrideSingleItemScale: false };
const pending = new Set();

/**
 * A downed adversary (all Hit Points marked, or Dead / Defeated) that carries inventory items or gold becomes an
 * Item Piles loot pile, so players can take what it had. If it recovers, the token turns back into a normal one.
 * Called during init.
 */
export function registerDeathLoot() {
	game.settings.register(MODULE_ID, "deathLoot", {
		name: "MIST_AGE.DeathLoot.Name",
		hint: "MIST_AGE.DeathLoot.Hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true
	});

	Hooks.on("updateActor", (actor, changes) => {
		if (foundry.utils.hasProperty(changes, "system.resources.hitPoints")) {
			queueCheck(actor);
		}
	});
	Hooks.on("createActiveEffect", effect => {
		if (isDownEffect(effect)) {
			queueCheck(effect.parent);
		}
	});
	Hooks.on("deleteActiveEffect", effect => {
		if (isDownEffect(effect)) {
			queueCheck(effect.parent);
		}
	});
}

function isDownEffect(effect) {
	return DOWN_STATUSES.some(status => effect.statuses?.has(status));
}

/** Runs on the active GM only, after the actor has re-prepared its statuses. */
function queueCheck(actor) {
	if (actor?.type !== "adversary" || !game.users.activeGM?.isSelf || !game.itempiles) {
		return;
	}
	if (!game.settings.get(MODULE_ID, "deathLoot")) {
		return;
	}
	setTimeout(() => syncDeathLoot(actor), 0);
}

function isDown(actor) {
	const hitPoints = actor.system.resources?.hitPoints;
	const markedOut = hitPoints?.max > 0 && hitPoints.value >= hitPoints.max;
	return markedOut || DOWN_STATUSES.some(status => actor.statuses.has(status));
}

function hasLoot(actor) {
	const hasGold = Object.values(actor.system.gold ?? {}).some(amount => amount > 0);
	return hasGold || actor.items.some(item => INVENTORY_TYPES.has(item.type));
}

async function syncDeathLoot(actor) {
	const api = game.itempiles.API;
	const down = isDown(actor);
	const tokens = actor.isToken ? [actor.token] : actor.getActiveTokens(true, true);
	for (const token of tokens) {
		if (!token || pending.has(token.uuid)) {
			continue;
		}
		const isPile = api.isValidItemPile(token);
		pending.add(token.uuid);
		try {
			if (down && !isPile && hasLoot(actor)) {
				await api.turnTokensIntoItemPiles(token, { pileSettings: BODY_PILE_SETTINGS, tokenSettings: { [DEATH_LOOT_FLAG]: true } });
			} else if (!down && isPile && foundry.utils.getProperty(token, DEATH_LOOT_FLAG)) {
				await api.revertTokensFromItemPiles(token, { tokenSettings: { [DEATH_LOOT_FLAG]: false } });
			}
		} finally {
			pending.delete(token.uuid);
		}
	}
}
