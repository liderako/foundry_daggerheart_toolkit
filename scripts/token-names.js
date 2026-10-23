import { MODULE_ID } from "./shared.js";

const SYNCED_TYPES = new Set(["character", "companion"]);

/**
 * Keeps the token names of characters and companions equal to the actor name: in the prototype token and in every
 * linked token placed on a scene. Foundry sets a token name only when the token is created, so a renamed character
 * kept its old name on the map, in chat and in the combat tracker. The syncTokenNames setting turns this off.
 * Called during init.
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

	// The prototype is part of the actor, so it is renamed in the same update, by whoever renames the actor.
	Hooks.on("preUpdateActor", (actor, changes) => {
		if (("name" in changes) && !foundry.utils.hasProperty(changes, "prototypeToken.name") && isSynced(actor)) {
			foundry.utils.setProperty(changes, "prototypeToken.name", changes.name);
		}
	});
	// Placed tokens belong to scenes, which players cannot update, so the active GM renames them.
	Hooks.on("updateActor", (actor, changes) => {
		if (("name" in changes) && isSynced(actor) && game.users.activeGM?.isSelf) {
			syncPlacedTokens([actor]);
		}
	});
	// Also catches renames made while no GM was online.
	Hooks.once("ready", syncAllTokenNames);
}

function isSynced(actor) {
	return SYNCED_TYPES.has(actor?.type) && !game.itempiles?.API.isValidItemPile(actor) && game.settings.get(MODULE_ID, "syncTokenNames");
}

/** Gives the linked tokens of these actors, on every scene, the actor name. Returns how many tokens were renamed. */
async function syncPlacedTokens(actors) {
	const names = new Map(actors.map(actor => [actor.id, actor.name]));
	let renamed = 0;
	for (const scene of game.scenes) {
		const updates = scene.tokens
			.filter(token => token.actorLink && names.has(token.actorId) && token.name !== names.get(token.actorId))
			.map(token => ({ _id: token.id, name: names.get(token.actorId) }));
		if (updates.length) {
			await scene.updateEmbeddedDocuments("Token", updates);
			renamed += updates.length;
		}
	}
	return renamed;
}

async function syncAllTokenNames() {
	if (!game.ready || !game.users.activeGM?.isSelf) {
		return;
	}
	const actors = game.actors.filter(isSynced);
	let renamed = 0;
	for (const actor of actors) {
		if (actor.prototypeToken.name !== actor.name) {
			await actor.update({ "prototypeToken.name": actor.name });
			renamed++;
		}
	}
	renamed += await syncPlacedTokens(actors);
	if (renamed) {
		ui.notifications.info(game.i18n.format("MIST_AGE.TokenNames.Synced", { count: renamed }));
	}
}
