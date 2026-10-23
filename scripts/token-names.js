import { MODULE_ID } from "./shared.js";

// Raise to run the one-time repair of existing token names again after changing it.
const REPAIR_VERSION = 1;

/**
 * Keeps every token's name equal to the name on its sheet, so the map, chat, combat tracker and sheet agree:
 * - a linked token carries the actor name;
 * - an unlinked token carries its own sheet name: the actor name, unless that one token was given a name of its own;
 * - the prototype token follows the actor name when the actor is renamed.
 * Foundry names a token once, when it is placed, and an unlinked token placed under another name keeps that name on
 * its sheet too. So an actor copied from "Royal Advisor" and renamed kept placing "Royal Advisor" tokens with
 * "Royal Advisor" sheets. The syncTokenNames setting turns this off. Called during init.
 */
export function registerTokenNames() {
	game.settings.register(MODULE_ID, "syncTokenNames", {
		name: "MIST_AGE.TokenNames.Name",
		hint: "MIST_AGE.TokenNames.Hint",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
		onChange: enabled => {
			if (enabled) {
				syncAllTokenNames();
			}
		}
	});
	game.settings.register(MODULE_ID, "tokenNamesRepairVersion", {
		scope: "world",
		config: false,
		type: Number,
		default: 0
	});

	// The prototype is part of the actor, so it is renamed in the same update, by whoever renames the actor.
	Hooks.on("preUpdateActor", (actor, changes) => {
		if (!actor.isToken && ("name" in changes) && !foundry.utils.hasProperty(changes, "prototypeToken.name") && isSynced(actor)) {
			foundry.utils.setProperty(changes, "prototypeToken.name", changes.name);
		}
	});
	// Placed tokens belong to scenes, which players cannot update, so the active GM renames them.
	Hooks.on("updateActor", (actor, changes) => {
		if (!("name" in changes) || !canSync(actor)) {
			return;
		}
		if (!actor.isToken) {
			syncPlacedTokens([actor], { unlinked: true });
		} else if (actor.token && !isPile(actor.token) && actor.token.name !== actor.name) {
			// The sheet of one unlinked token was renamed.
			actor.token.update({ name: actor.name });
		}
	});
	// A renamed unlinked token gets the same name on its sheet.
	Hooks.on("updateToken", (token, changes) => {
		if (!("name" in changes) || token.actorLink || !token.baseActor || isPile(token) || !canSync(token.baseActor)) {
			return;
		}
		const sheetName = ownSheetName(token, token.name);
		if (getOwnSheetName(token) !== sheetName) {
			token.update({ delta: { name: sheetName } });
		}
	});
	Hooks.once("ready", syncAllTokenNames);
}

function isSynced(actor) {
	return !!actor && !isPile(actor) && game.settings.get(MODULE_ID, "syncTokenNames");
}

function canSync(actor) {
	return isSynced(actor) && !!game.users.activeGM?.isSelf;
}

function isPile(document) {
	return !!game.itempiles?.API.isValidItemPile(document);
}

/** The name an unlinked token keeps on its own sheet: null while it shows the actor name. */
function getOwnSheetName(token) {
	return token._source.delta?.name ?? null;
}

function ownSheetName(token, name) {
	return !name || name === token.baseActor.name ? null : name;
}

/**
 * Renames the placed tokens of these actors on every scene to the actor name: linked tokens, and with unlinked set,
 * unlinked tokens whose sheet shows the actor name. Returns how many tokens were renamed.
 */
async function syncPlacedTokens(actors, { unlinked = false } = {}) {
	const names = new Map(actors.map(actor => [actor.id, actor.name]));
	let renamed = 0;
	for (const scene of game.scenes) {
		const updates = scene.tokens
			.filter(token => names.has(token.actorId) && token.name !== names.get(token.actorId) && !isPile(token))
			.filter(token => token.actorLink || (unlinked && getOwnSheetName(token) === null))
			.map(token => ({ _id: token.id, name: names.get(token.actorId) }));
		if (updates.length) {
			await scene.updateEmbeddedDocuments("Token", updates);
			renamed += updates.length;
		}
	}
	return renamed;
}

async function syncAllTokenNames() {
	if (!game.ready || !game.users.activeGM?.isSelf || !game.settings.get(MODULE_ID, "syncTokenNames")) {
		return;
	}
	let renamed;
	if (game.settings.get(MODULE_ID, "tokenNamesRepairVersion") < REPAIR_VERSION) {
		renamed = await repairTokenNames();
		await game.settings.set(MODULE_ID, "tokenNamesRepairVersion", REPAIR_VERSION);
	} else {
		renamed = await syncPlacedTokens(game.actors.filter(isSynced));
	}
	if (renamed) {
		ui.notifications.info(game.i18n.format("MIST_AGE.TokenNames.Synced", { count: renamed }));
	}
}

/**
 * Clears names left behind by actors that were copied and renamed: every prototype gets the actor name, every token
 * the name on its sheet. A name of the actor's old prototype, or of a compendium actor such as "Sellsword", is a
 * leftover; any other name given to one token or its sheet is kept, the sheet's first. Returns the renamed count.
 */
async function repairTokenNames() {
	const templates = new Set();
	for (const pack of game.packs.filter(p => p.documentName === "Actor")) {
		for (const entry of pack.index) {
			templates.add(entry.name);
		}
	}
	const actors = new Map(game.actors.filter(isSynced).map(actor => [actor.id, actor]));
	const oldPrototypes = new Map([...actors.values()].map(actor => [actor.id, actor.prototypeToken.name]));
	const isOwnName = (name, actor) => !!name && name !== actor.name && name !== oldPrototypes.get(actor.id) && !templates.has(name);

	const prototypeUpdates = [...actors.values()]
		.filter(actor => actor.prototypeToken.name !== actor.name)
		.map(actor => ({ _id: actor.id, "prototypeToken.name": actor.name }));
	if (prototypeUpdates.length) {
		await Actor.implementation.updateDocuments(prototypeUpdates);
	}

	let renamed = prototypeUpdates.length;
	for (const scene of game.scenes) {
		const updates = [];
		for (const token of scene.tokens) {
			const actor = actors.get(token.actorId);
			if (!actor || isPile(token)) {
				continue;
			}
			if (token.actorLink) {
				if (token.name !== actor.name) {
					updates.push({ _id: token.id, name: actor.name });
				}
				continue;
			}
			const sheetName = getOwnSheetName(token);
			const name = [sheetName, token.name].find(n => isOwnName(n, actor)) ?? actor.name;
			const update = {};
			if (token.name !== name) {
				update.name = name;
			}
			if (sheetName !== ownSheetName(token, name)) {
				update.delta = { name: ownSheetName(token, name) };
			}
			if (Object.keys(update).length) {
				updates.push({ _id: token.id, ...update });
			}
		}
		if (updates.length) {
			await scene.updateEmbeddedDocuments("Token", updates);
			renamed += updates.length;
		}
	}
	return renamed;
}
