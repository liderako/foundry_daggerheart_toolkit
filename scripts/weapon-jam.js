import { CONSUMES_PATH, consumesAmmo } from "./ammunition.js";
import { MODULE_ID, SOCKET, checkedValues, getPlayerCharacter, rerenderItemAndActorSheets } from "./shared.js";

const JAM_DIE_PATH = `flags.${MODULE_ID}.jamDie`;
const JAM_COUNT_PATH = `flags.${MODULE_ID}.jamCount`;
const JAMMED_FLAG = `flags.${MODULE_ID}.jammed`;
const JAM_DICE = ["d4", "d6", "d8", "d10", "d12"];
const DEFAULT_JAM_DIE = "d6";
// Fixed id of the "Clear weapon jam" action given to a jammed weapon. Action ids are 16 letters or digits.
const CLEAR_JAM_ID = "mistAgeClearJam0";
const JAM_ICON = "icons/svg/hazard.svg";
const CARE_MOVE = "mistAgeWeaponCare";

/**
 * Weapon jams for weapons that consume ammunition. Each such weapon has a jam die and a number of jam dice. From the
 * Daggerheart Menu the GM asks a player for a jam roll, where the player picks weapons and rolls their jam dice: any
 * 1 jams the weapon with an effect, and the weapon gets a "Clear weapon jam" action that removes it for 1 Stress. The
 * GM also raises the jam dice of chosen characters. Weapon Care on a rest sets them back to 1. The weaponJam setting
 * turns this off. Called during init.
 */
export function registerWeaponJam() {
	game.settings.register(MODULE_ID, "weaponJam", {
		name: "MIST_AGE.Jam.Setting.Name",
		hint: "MIST_AGE.Jam.Setting.Hint",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
		onChange: () => {
			rerenderItemAndActorSheets();
			ui.daggerheartMenu?.render();
		}
	});

	Hooks.on("renderItemSheetV2", (sheet, element) => {
		if (sheet.document.type === "weapon" && isEnabled()) {
			injectJamFields(sheet, element, sheet.document);
		}
	});
	Hooks.on("renderDaggerheartMenu", injectMenu);
	Hooks.on("renderDhpDowntime", fixCareTooltips);
	// Runs after the action's Stress cost is paid. Hooks.call stops at a false result.
	Hooks.on("daggerheart.postUseAction", action => {
		if (action.id === CLEAR_JAM_ID) {
			clearJam(action.item);
		}
	});
	Hooks.once("ready", () => {
		game.socket.on(SOCKET, onSocketMessage);
	});
	patchDowntime();
}

function isEnabled() {
	return game.settings.get(MODULE_ID, "weaponJam");
}

function getJamDie(weapon) {
	const die = foundry.utils.getProperty(weapon, JAM_DIE_PATH);
	return JAM_DICE.includes(die) ? die : DEFAULT_JAM_DIE;
}

function getJamCount(weapon) {
	return Math.max(1, Math.floor(Number(foundry.utils.getProperty(weapon, JAM_COUNT_PATH)) || 1));
}

function getAmmoWeapons(actor) {
	return actor?.items.filter(consumesAmmo) ?? [];
}

function isJammed(weapon) {
	return weapon.effects.some(effect => foundry.utils.getProperty(effect, JAMMED_FLAG));
}

function isPile(document) {
	return !!game.itempiles?.API.isValidItemPile(document);
}

function localize(key, data) {
	return data ? game.i18n.format(`MIST_AGE.Jam.${key}`, data) : game.i18n.localize(`MIST_AGE.Jam.${key}`);
}

function weaponLabel(weapon) {
	const escape = foundry.utils.escapeHTML;
	const jammed = isJammed(weapon) ? ` <i class="fa-solid fa-triangle-exclamation" data-tooltip="${escape(localize("Effect"))}"></i>` : "";
	return `<img src="${escape(weapon.img)}" alt=""><span>${escape(weapon.name)}${jammed}</span>
		<span class="mist-jam-dice">${getJamCount(weapon)}${getJamDie(weapon)}</span>`;
}

/* -------------------------------------------- */
/*  Weapon settings                             */
/* -------------------------------------------- */

/** Puts the jam die and the number of jam dice right below the "Consumes ammunition" checkbox. */
function injectJamFields(sheet, element, weapon) {
	const checkbox = element.querySelector(`.mist-ammo-fields input[name="${CONSUMES_PATH}"]`);
	if (!checkbox || element.querySelector(".mist-jam-field")) {
		return;
	}
	const disabled = sheet.isEditable ? "" : "disabled";
	const die = getJamDie(weapon);
	const options = JAM_DICE.map(d => `<option value="${d}" ${d === die ? "selected" : ""}>${d}</option>`).join("");
	checkbox.insertAdjacentHTML("afterend", `
		<span class="mist-jam-field">${localize("Die")}</span>
		<select name="${JAM_DIE_PATH}" ${disabled}>${options}</select>
		<span class="mist-jam-field">${localize("Count")}</span>
		<input type="number" name="${JAM_COUNT_PATH}" value="${getJamCount(weapon)}" min="1" step="1" data-dtype="Number" ${disabled} />
	`);
}

/* -------------------------------------------- */
/*  Daggerheart Menu                            */
/* -------------------------------------------- */

function injectMenu(app, element) {
	if (!game.user.isGM || !isEnabled() || element.querySelector(".mist-jam-menu")) {
		return;
	}
	const html = `
		<fieldset class="mist-jam-menu">
			<legend>${localize("Menu.Legend")}</legend>
			<div class="menu-options-container">
				<div class="menu-options-inner-container">
					<button type="button" data-mist-jam="request">${localize("Menu.Request")}</button>
					<button type="button" data-mist-jam="raise">${localize("Menu.Raise")}</button>
				</div>
			</div>
		</fieldset>`;
	const anchor = element.querySelector("[data-action='showEffectChangePaths']");
	if (anchor) {
		anchor.insertAdjacentHTML("beforebegin", html);
	} else {
		(element.querySelector("fieldset")?.parentElement ?? element).insertAdjacentHTML("beforeend", html);
	}
	element.querySelector("[data-mist-jam='request']").addEventListener("click", requestJamRoll);
	element.querySelector("[data-mist-jam='raise']").addEventListener("click", raiseJamDice);
}

async function requestJamRoll() {
	const players = game.users
		.filter(user => user.active && !user.isGM)
		.map(user => ({ user, actor: getPlayerCharacter(user) }))
		.filter(player => player.actor);
	if (!players.length) {
		ui.notifications.warn(localize("NoPlayers"));
		return;
	}
	const escape = foundry.utils.escapeHTML;
	const options = players
		.map(({ user, actor }) => `<option value="${user.id}">${escape(user.name)} — ${escape(actor.name)}</option>`)
		.join("");
	const userId = await foundry.applications.api.DialogV2.prompt({
		window: { title: localize("Request.Title"), icon: "fa-solid fa-crosshairs" },
		content: `<div class="form-group"><label>${localize("Request.Player")}</label><select name="userId">${options}</select></div>`,
		ok: { label: localize("Request.Button"), icon: "fa-solid fa-paper-plane", callback: (event, button) => button.form.elements.userId.value }
	});
	const player = players.find(p => p.user.id === userId);
	if (!player) {
		return;
	}
	game.socket.emit(SOCKET, { type: "jamRoll", userId: player.user.id, actorUuid: player.actor.uuid });
	ui.notifications.info(localize("Request.Sent", { player: player.user.name }));
}

async function raiseJamDice() {
	const actors = game.actors.filter(actor => actor.type === "character" && !isPile(actor) && getAmmoWeapons(actor).length);
	if (!actors.length) {
		ui.notifications.warn(localize("Raise.NoCharacters"));
		return;
	}
	const escape = foundry.utils.escapeHTML;
	const rows = actors.map(actor => `
		<label class="mist-jam-option">
			<input type="checkbox" name="actor" value="${actor.id}">
			<span>${escape(actor.name)}</span>
			<span class="mist-jam-dice">${getAmmoWeapons(actor).map(w => `${escape(w.name)} ${getJamCount(w)}${getJamDie(w)}`).join(", ")}</span>
		</label>`).join("");
	const ids = await foundry.applications.api.DialogV2.prompt({
		window: { title: localize("Raise.Title"), icon: "fa-solid fa-arrow-up" },
		position: { width: 480 },
		content: `<p>${localize("Raise.Hint")}</p><div class="mist-jam-options">${rows}</div>`,
		ok: { label: localize("Raise.Button"), icon: "fa-solid fa-arrow-up", callback: (event, button) => checkedValues(button.form, "actor") }
	});
	if (!Array.isArray(ids) || !ids.length) {
		return;
	}
	for (const id of ids) {
		const actor = game.actors.get(id);
		const updates = getAmmoWeapons(actor).map(weapon => ({ _id: weapon.id, [JAM_COUNT_PATH]: getJamCount(weapon) + 1 }));
		await actor.updateEmbeddedDocuments("Item", updates);
	}
	ui.notifications.info(localize("Raise.Done", { count: ids.length }));
}

/* -------------------------------------------- */
/*  Jam roll                                    */
/* -------------------------------------------- */

function onSocketMessage(data) {
	if (data?.type !== "jamRoll" || data.userId !== game.user.id) {
		return;
	}
	const actor = fromUuidSync(data.actorUuid);
	if (actor?.isOwner) {
		openJamRollDialog(actor);
	}
}

async function openJamRollDialog(actor) {
	const weapons = getAmmoWeapons(actor);
	if (!weapons.length) {
		ui.notifications.warn(localize("Roll.NoWeapons", { actor: actor.name }));
		return;
	}
	const rows = weapons.map(weapon => `
		<label class="mist-jam-option">
			<input type="checkbox" name="weapon" value="${weapon.id}">
			${weaponLabel(weapon)}
		</label>`).join("");
	const ids = await foundry.applications.api.DialogV2.prompt({
		window: { title: localize("Roll.Title"), icon: "fa-solid fa-crosshairs" },
		position: { width: 420 },
		content: `<p>${localize("Roll.Hint")}</p><div class="mist-jam-options">${rows}</div>`,
		ok: { label: localize("Roll.Button"), icon: "fa-solid fa-dice", callback: (event, button) => checkedValues(button.form, "weapon") }
	});
	if (!Array.isArray(ids)) {
		return;
	}
	for (const id of ids) {
		await rollJam(actor, actor.items.get(id));
	}
}

/** Rolls the weapon's jam dice to chat; any 1 jams it. */
async function rollJam(actor, weapon) {
	const roll = await new Roll(`${getJamCount(weapon)}${getJamDie(weapon)}`).evaluate();
	const jammed = roll.dice.some(die => die.results.some(result => result.result === 1));
	const outcome = jammed ? `<strong>${localize("Roll.Jammed")}</strong>` : localize("Roll.Holds");
	await roll.toMessage({
		speaker: ChatMessage.implementation.getSpeaker({ actor }),
		flavor: `${localize("Roll.Title")}: ${foundry.utils.escapeHTML(weapon.name)} — ${outcome}`
	});
	if (jammed) {
		await jamWeapon(weapon);
	}
}

/** Marks the weapon jammed and gives it the action that clears the jam. */
async function jamWeapon(weapon) {
	if (!isJammed(weapon)) {
		await weapon.createEmbeddedDocuments("ActiveEffect", [{
			name: localize("Effect"),
			img: JAM_ICON,
			description: localize("EffectHint"),
			transfer: true,
			flags: { [MODULE_ID]: { jammed: true } }
		}]);
	}
	if (!weapon.system.actions?.get(CLEAR_JAM_ID)) {
		const cls = game.system.api.models.actions.actionsTypes.effect;
		const action = new cls({
			type: "effect",
			...cls.getSourceConfig(weapon.system),
			_id: CLEAR_JAM_ID,
			name: localize("ClearAction"),
			img: JAM_ICON,
			description: `<p>${localize("ClearActionHint")}</p>`,
			cost: [{ key: "stress", value: 1 }]
		}, { parent: weapon.system });
		await weapon.update({ [`system.actions.${CLEAR_JAM_ID}`]: action.toObject() });
	}
}

async function clearJam(weapon) {
	if (!weapon) {
		return;
	}
	const effects = weapon.effects.filter(effect => foundry.utils.getProperty(effect, JAMMED_FLAG)).map(effect => effect.id);
	if (effects.length) {
		await weapon.deleteEmbeddedDocuments("ActiveEffect", effects);
	}
	if (weapon.system.actions?.get(CLEAR_JAM_ID)) {
		await weapon.update({ [`system.actions.${CLEAR_JAM_ID}`]: _del });
	}
}

/* -------------------------------------------- */
/*  Weapon Care on rests                        */
/* -------------------------------------------- */

/**
 * Adds Weapon Care to the short and long rest moves of the Daggerheart downtime dialog, for characters with weapons
 * that consume ammunition. The move lives only in the dialog, not in the world's homebrew rest moves.
 */
function patchDowntime() {
	const Downtime = game.system.api?.applications?.dialogs?.Downtime;
	if (!Downtime) {
		return;
	}
	const prepareContext = Downtime.prototype._prepareContext;
	Downtime.prototype._prepareContext = async function (options) {
		addCareMoves(this);
		return prepareContext.call(this, options);
	};
	const takeDowntime = Downtime.DEFAULT_OPTIONS.actions.takeDowntime;
	Downtime.DEFAULT_OPTIONS.actions.takeDowntime = async function (...args) {
		// Read before the dialog resets its selection.
		const shortCare = this.moveData.shortRest?.moves[CARE_MOVE]?.selected ?? 0;
		const longCare = this.moveData.longRest?.moves[CARE_MOVE]?.selected ?? 0;
		await takeDowntime.call(this, ...args);
		if (longCare) {
			await resetJamDice(this.actor, getAmmoWeapons(this.actor));
		}
		for (let i = 0; i < shortCare; i++) {
			await openWeaponCareDialog(this.actor);
		}
	};
}

function addCareMoves(app) {
	if (app[MODULE_ID]?.careAdded || !isEnabled() || !getAmmoWeapons(app.actor).length) {
		return;
	}
	app[MODULE_ID] = { careAdded: true };
	for (const category of ["shortRest", "longRest"]) {
		const moves = app.moveData[category]?.moves;
		if (moves && !moves[CARE_MOVE]) {
			moves[CARE_MOVE] = {
				name: localize("Care.Name"),
				icon: "fa-solid fa-screwdriver-wrench",
				img: "icons/tools/smithing/hammer-sledge-steel-grey.webp",
				description: `<p>${localize(`Care.${category}`)}</p>`,
				actions: [],
				effects: []
			};
		}
	}
}

/** Daggerheart looks up rest move tooltips in the homebrew settings, where Weapon Care is not; give it plain text. */
function fixCareTooltips(app, element) {
	for (const move of element.querySelectorAll(`.activity-container[data-move="${CARE_MOVE}"]`)) {
		move.dataset.tooltip = localize(`Care.${move.dataset.category}`);
	}
}

async function openWeaponCareDialog(actor) {
	const weapons = getAmmoWeapons(actor);
	if (!weapons.length) {
		return;
	}
	const rows = weapons.map((weapon, index) => `
		<label class="mist-jam-option">
			<input type="radio" name="weapon" value="${weapon.id}" ${index === 0 ? "checked" : ""}>
			${weaponLabel(weapon)}
		</label>`).join("");
	const id = await foundry.applications.api.DialogV2.prompt({
		window: { title: localize("Care.Name"), icon: "fa-solid fa-screwdriver-wrench" },
		position: { width: 420 },
		content: `<p>${localize("Care.shortRest")}</p><div class="mist-jam-options">${rows}</div>`,
		ok: { label: localize("Care.Button"), icon: "fa-solid fa-screwdriver-wrench", callback: (event, button) => checkedValues(button.form, "weapon")[0] }
	});
	const weapon = actor.items.get(id);
	if (weapon) {
		await resetJamDice(actor, [weapon]);
	}
}

async function resetJamDice(actor, weapons) {
	const updates = weapons.filter(weapon => getJamCount(weapon) !== 1).map(weapon => ({ _id: weapon.id, [JAM_COUNT_PATH]: 1 }));
	if (updates.length) {
		await actor.updateEmbeddedDocuments("Item", updates);
	}
	ui.notifications.info(localize("Care.Done", { actor: actor.name, weapons: weapons.map(weapon => weapon.name).join(", ") }));
}
