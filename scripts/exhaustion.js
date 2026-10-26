import { MODULE_ID, SOCKET, checkedValues, getPlayerCharacter, rerenderActorSheets } from "./shared.js";

const BASE_DIFFICULTY = 15;
const EXHAUSTION_FLAG = `flags.${MODULE_ID}.exhaustion`;
const EXHAUSTION_ICON = "icons/svg/unconscious.svg";

/**
 * Outcomes of an exhaustion check: Stress marked (negative clears), Hope gained, how much harder the next check gets,
 * and the d100 threshold at or under which the character loses 1 Hope.
 */
const OUTCOMES = {
	critical: { stress: -1, hope: 1, raise: 4 },
	successHope: { stress: 1, raise: 2 },
	successFear: { stress: 2, raise: 2 },
	failureHope: { stress: 2, raise: 2, loseHopeAt: 50 },
	failureFear: { stress: 3, raise: 4, loseHopeAt: 80 }
};

/**
 * Exhaustion checks. From the Daggerheart Menu the GM asks chosen players for an exhaustion check, each on their own;
 * the check can also be rolled with a button next to the rest buttons of the character sheet, by its owner or by the GM
 * for a player who is offline. It is a Strength roll against the character's exhaustion difficulty, 15 at first. The outcome marks Stress,
 * Hope and Hit Points by the table above and raises the difficulty until the next long rest. After a quiet day the
 * first check since the long rest has advantage. The difficulty lives on an effect on the character, removed by a long
 * rest. The exhaustionChecks setting turns this off; exhaustionSheetButton hides only the sheet button, leaving checks to
 * the GM's requests. Called during init.
 */
export function registerExhaustion() {
	game.settings.register(MODULE_ID, "exhaustionChecks", {
		name: "MIST_AGE.Exhaustion.Setting.Name",
		hint: "MIST_AGE.Exhaustion.Setting.Hint",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
		onChange: () => {
			ui.daggerheartMenu?.render();
			rerenderActorSheets();
		}
	});
	game.settings.register(MODULE_ID, "exhaustionSheetButton", {
		name: "MIST_AGE.Exhaustion.SheetButtonSetting.Name",
		hint: "MIST_AGE.Exhaustion.SheetButtonSetting.Hint",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
		onChange: rerenderActorSheets
	});
	Hooks.on("renderDaggerheartMenu", injectMenu);
	Hooks.on("renderActorSheetV2", injectSheetButton);
	Hooks.once("ready", () => {
		game.socket.on(SOCKET, onSocketMessage);
	});
	patchLongRest();
}

/** Puts an exhaustion check button after the short and long rest buttons of an editable character sheet. */
function injectSheetButton(sheet, element) {
	const actor = sheet.document;
	const restButtons = element.querySelector(".downtime-section");
	if (!isEnabled() || !game.settings.get(MODULE_ID, "exhaustionSheetButton") || actor?.type !== "character" || !sheet.isEditable
		|| !restButtons || restButtons.querySelector(".mist-exhaustion-button")) {
		return;
	}
	const tooltip = foundry.utils.escapeHTML(localize("Sheet.Tooltip", { difficulty: getExhaustion(actor).difficulty }));
	restButtons.insertAdjacentHTML("beforeend", `
		<button type="button" class="mist-exhaustion-button" data-tooltip="${tooltip}" aria-label="${tooltip}">
			<i class="fa-solid fa-fw fa-face-tired" inert></i>
		</button>`);
	restButtons.querySelector(".mist-exhaustion-button").addEventListener("click", () => rollFromSheet(actor));
}

/** The first check since a long rest asks whether the day was quiet, which grants advantage by the exhaustion rules. */
async function rollFromSheet(actor) {
	let quietDay = false;
	if (getExhaustion(actor).checks === 0) {
		quietDay = await foundry.applications.api.DialogV2.confirm({
			window: { title: localize("Roll.Title"), icon: "fa-solid fa-bed" },
			content: `<p>${localize("Sheet.QuietDay")}</p>`
		});
		if (quietDay === null) {
			return;
		}
	}
	await rollExhaustion(actor, { quietDay });
}

function isEnabled() {
	return game.settings.get(MODULE_ID, "exhaustionChecks");
}

function localize(key, data) {
	return data ? game.i18n.format(`MIST_AGE.Exhaustion.${key}`, data) : game.i18n.localize(`MIST_AGE.Exhaustion.${key}`);
}

function getExhaustionEffect(actor) {
	return actor.effects.find(effect => foundry.utils.getProperty(effect, EXHAUSTION_FLAG));
}

/** The character's exhaustion since the last long rest: the next difficulty and how many checks were made. */
export function getExhaustion(actor) {
	const state = foundry.utils.getProperty(getExhaustionEffect(actor) ?? {}, EXHAUSTION_FLAG);
	return { difficulty: state?.difficulty ?? BASE_DIFFICULTY, checks: state?.checks ?? 0 };
}

/* -------------------------------------------- */
/*  GM: request and reset                       */
/* -------------------------------------------- */

function injectMenu(app, element) {
	if (!game.user.isGM || !isEnabled() || element.querySelector(".mist-exhaustion-menu")) {
		return;
	}
	const html = `
		<fieldset class="mist-exhaustion-menu">
			<legend>${localize("Menu.Legend")}</legend>
			<div class="menu-options-container">
				<div class="menu-options-inner-container">
					<button type="button" data-mist-exhaustion="request">${localize("Menu.Request")}</button>
					<button type="button" data-mist-exhaustion="reset">${localize("Menu.Reset")}</button>
				</div>
			</div>
		</fieldset>`;
	const anchor = element.querySelector("[data-action='showEffectChangePaths']");
	if (anchor) {
		anchor.insertAdjacentHTML("beforebegin", html);
	} else {
		(element.querySelector("fieldset")?.parentElement ?? element).insertAdjacentHTML("beforeend", html);
	}
	element.querySelector("[data-mist-exhaustion='request']").addEventListener("click", requestExhaustionChecks);
	element.querySelector("[data-mist-exhaustion='reset']").addEventListener("click", resetExhaustion);
}

async function requestExhaustionChecks() {
	const players = game.users
		.filter(user => user.active && !user.isGM)
		.map(user => ({ user, actor: getPlayerCharacter(user) }))
		.filter(player => player.actor);
	if (!players.length) {
		ui.notifications.warn(localize("NoPlayers"));
		return;
	}
	const escape = foundry.utils.escapeHTML;
	const rows = players.map(({ user, actor }) => {
		const { difficulty } = getExhaustion(actor);
		return `
			<label class="mist-jam-option">
				<input type="checkbox" name="user" value="${user.id}" checked>
				<span>${escape(user.name)} — ${escape(actor.name)}</span>
				<span class="mist-jam-dice">${localize("Difficulty", { difficulty })}</span>
			</label>`;
	}).join("");
	const choice = await foundry.applications.api.DialogV2.prompt({
		window: { title: localize("Request.Title"), icon: "fa-solid fa-bed" },
		position: { width: 460 },
		content: `
			<p>${localize("Request.Hint")}</p>
			<div class="mist-jam-options">${rows}</div>
			<label class="mist-jam-option"><input type="checkbox" name="quietDay"> <span>${localize("Request.QuietDay")}</span></label>`,
		ok: {
			label: localize("Request.Button"),
			icon: "fa-solid fa-paper-plane",
			callback: (event, button) => ({ userIds: checkedValues(button.form, "user"), quietDay: button.form.elements.quietDay.checked })
		}
	});
	if (!choice?.userIds?.length) {
		return;
	}
	for (const { user, actor } of players.filter(player => choice.userIds.includes(player.user.id))) {
		game.socket.emit(SOCKET, { type: "exhaustionCheck", userId: user.id, actorUuid: actor.uuid, quietDay: choice.quietDay });
	}
	ui.notifications.info(localize("Request.Sent", { count: choice.userIds.length }));
}

/** For a long rest the system's own refresh handles, or any time the GM wants the difficulties back at 15. */
async function resetExhaustion() {
	const confirmed = await foundry.applications.api.DialogV2.confirm({
		window: { title: localize("Reset.Title") },
		content: `<p>${localize("Reset.Hint")}</p>`
	});
	if (!confirmed) {
		return;
	}
	let count = 0;
	for (const actor of game.actors.filter(a => a.type === "character")) {
		const effect = getExhaustionEffect(actor);
		if (effect) {
			await effect.delete();
			count++;
		}
	}
	ui.notifications.info(localize("Reset.Done", { count }));
}

/** Clears a character's exhaustion when its player takes a long rest in the downtime dialog. */
function patchLongRest() {
	const Downtime = game.system.api?.applications?.dialogs?.Downtime;
	if (!Downtime) {
		return;
	}
	const takeDowntime = Downtime.DEFAULT_OPTIONS.actions.takeDowntime;
	Downtime.DEFAULT_OPTIONS.actions.takeDowntime = async function (...args) {
		await takeDowntime.call(this, ...args);
		const effect = this.shortrest ? null : getExhaustionEffect(this.actor);
		if (effect) {
			await effect.delete();
		}
	};
}

/* -------------------------------------------- */
/*  Player: the check                           */
/* -------------------------------------------- */

function onSocketMessage(data) {
	if (data?.type !== "exhaustionCheck" || data.userId !== game.user.id) {
		return;
	}
	const actor = fromUuidSync(data.actorUuid, { strict: false });
	if (actor?.isOwner) {
		rollExhaustion(actor, { quietDay: !!data.quietDay });
	}
}

/** Rolls Strength in the Daggerheart roll dialog against the exhaustion difficulty and applies the outcome. */
export async function rollExhaustion(actor, { quietDay = false } = {}) {
	const { difficulty, checks } = getExhaustion(actor);
	const advantage = quietDay && checks === 0 ? 1 : 0;
	const config = await actor.rollTrait("strength", {
		title: localize("Roll.Title"),
		roll: { trait: "strength", type: "trait", difficulty, advantage }
	});
	const roll = config?.roll;
	if (!roll || typeof roll.success !== "boolean") {
		return;
	}
	const duality = roll.result?.duality;
	const key = roll.isCritical ? "critical" : `${roll.success ? "success" : "failure"}${duality === -1 ? "Fear" : "Hope"}`;
	await applyOutcome(actor, key, { difficulty, checks });
}

/** Marks or clears Stress; Stress that cannot be marked becomes a marked Hit Point. */
function markStress(state, amount) {
	if (amount < 0) {
		if (state.stress > 0) {
			state.stress = Math.max(0, state.stress + amount);
			state.notes.push("stressCleared");
		}
		return;
	}
	for (let i = 0; i < amount; i++) {
		if (state.stress < state.stressMax) {
			state.stress++;
			state.notes.push("stress");
		} else if (state.hp < state.hpMax) {
			state.hp++;
			state.notes.push("hp");
		}
	}
}

async function applyOutcome(actor, key, { difficulty, checks }) {
	const outcome = OUTCOMES[key];
	const { stress, hope, hitPoints } = actor.system.resources;
	const state = {
		stress: stress.value, stressMax: stress.max,
		hope: hope.value, hopeMax: hope.max,
		hp: hitPoints.value, hpMax: hitPoints.max,
		notes: []
	};
	markStress(state, outcome.stress);
	if (outcome.hope) {
		state.hope = Math.min(state.hopeMax, state.hope + outcome.hope);
	}
	let d100;
	if (outcome.loseHopeAt) {
		d100 = await new Roll("1d100").evaluate();
		if (d100.total <= outcome.loseHopeAt) {
			if (state.hope > 0) {
				state.hope--;
				state.notes.push("hopeLost");
			} else {
				markStress(state, 1);
			}
		}
	}
	await actor.update({
		"system.resources.stress.value": state.stress,
		"system.resources.hope.value": state.hope,
		"system.resources.hitPoints.value": state.hp
	});

	const next = difficulty + outcome.raise;
	const effectData = {
		name: localize("Effect", { difficulty: next }),
		img: EXHAUSTION_ICON,
		description: localize("EffectHint"),
		[EXHAUSTION_FLAG]: { difficulty: next, checks: checks + 1 }
	};
	const effect = getExhaustionEffect(actor);
	if (effect) {
		await effect.update(effectData);
	} else {
		await actor.createEmbeddedDocuments("ActiveEffect", [foundry.utils.expandObject(effectData)]);
	}

	const changes = [
		state.notes.includes("stressCleared") ? localize("Result.StressCleared") : null,
		outcome.hope ? localize("Result.HopeGained") : null,
		state.notes.filter(note => note === "stress").length ? localize("Result.Stress", { count: state.notes.filter(note => note === "stress").length }) : null,
		state.notes.includes("hp") ? localize("Result.HitPoints", { count: state.notes.filter(note => note === "hp").length }) : null,
		d100 ? localize(d100.total <= outcome.loseHopeAt ? "Result.D100Lost" : "Result.D100Kept", { total: d100.total, threshold: outcome.loseHopeAt }) : null,
		state.notes.includes("hopeLost") ? localize("Result.HopeLost") : null,
		localize("Result.Next", { difficulty: next })
	].filter(Boolean);
	const content = `<h3>${localize(`Outcome.${key}`)}</h3><ul>${changes.map(line => `<li>${line}</li>`).join("")}</ul>`;
	const speaker = ChatMessage.implementation.getSpeaker({ actor });
	if (d100) {
		await d100.toMessage({ speaker, flavor: `${localize("Roll.Title")}: ${content}` });
	} else {
		await ChatMessage.implementation.create({ speaker, content: `<p><strong>${localize("Roll.Title")}</strong></p>${content}` });
	}
}
