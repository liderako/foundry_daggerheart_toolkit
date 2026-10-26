import { MODULE_ID } from "./shared.js";

const DEFAULT_REMINDER = "Don't forget to mark off 1 Ration for the long rest.";

/**
 * A reminder shown at the top of the Daggerheart long rest dialog, such as marking off a Ration. The text is the
 * longRestReminder setting; an empty text shows nothing. Called during init.
 */
export function registerRestReminder() {
	game.settings.register(MODULE_ID, "longRestReminder", {
		name: "MIST_AGE.Rest.Reminder.Name",
		hint: "MIST_AGE.Rest.Reminder.Hint",
		scope: "world",
		config: false,
		type: String,
		default: DEFAULT_REMINDER
	});
	Hooks.on("renderDhpDowntime", injectReminder);
}

function injectReminder(app, element) {
	const text = game.settings.get(MODULE_ID, "longRestReminder")?.trim();
	const header = element.querySelector(".dialog-header");
	if (app.shortrest || !text || !header || element.querySelector(".mist-rest-reminder")) {
		return;
	}
	header.insertAdjacentHTML("afterend", `
		<div class="mist-rest-reminder">
			<i class="fa-solid fa-drumstick-bite" inert></i>
			<span>${foundry.utils.escapeHTML(text)}</span>
		</div>`);
}
