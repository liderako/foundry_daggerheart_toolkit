# The Mist Age - Toolkit

A Foundry VTT module for the *The Mist Age* world on the Daggerheart system. It adds prices and weight to items, trading through Item Piles, character carrying load, HB copies of the compendiums and loot tables, an inventory for adversaries and companions, ammunition use and weapon jams, exhaustion checks, and token names kept in sync with their sheets.

## Requirements

| | Version |
|---|---|
| Foundry VTT | 13–14 |
| System | Daggerheart |
| Modules | [Item Piles](https://github.com/fantasycalendar/FoundryVTT-ItemPiles) 3.x (with socketlib and libWrapper) |

## Installation

In Foundry: **Add-on Modules → Install Module**, paste the link and click **Install**:

```
https://github.com/liderako/foundry_daggerheart_toolkit/releases/latest/download/module.json
```

Foundry offers to install Item Piles as well. Then enable the module in the world: **Game Settings → Manage Modules → The Mist Age - Toolkit**.

### First launch

The first time a GM loads the world, the module once:

- creates the world compendiums **Weapons (HB)**, **Armors (HB)**, **Consumables (HB)**, **Loot (HB)** and **Rolltables (HB)**;
- creates the loot tables in the **Weapons & Armor (HB)** folder;
- sets prices from the price table on every item that has no price yet;
- sets up the price attribute and currencies in Item Piles.

This takes a few seconds. These steps do not run again; only setting prices repeats, when the price table has changed.

## Features

### Prices and currency

- **Item price.** Weapons, armor, consumables and loot have a price. The GM sets it on the **Settings** tab of the item sheet.
- **Where the price shows:** in the header of the item sheet and as a tag on the item in the inventory. The price is broken down into coins with the currency icons of the Daggerheart homebrew settings, for example `2 Gold 50 Silver 3 Penny`.
- **Storage.** The price is stored in the main currency, handfuls: in The Mist Age that is Silver. The field takes fractions: `0.1` at a rate of 10 is one coin.
- **Exchange rates** are set in the settings. By default 10 coins = 1 handful, 100 handfuls = 1 bag, 10 bags = 1 chest. Changing a rate only changes how prices break down into coins; the prices themselves stay.
- **Item Piles.** The module tells Item Piles where the price is kept and builds its currencies from Daggerheart's: names, rates, the main currency. Merchants sell and buy at these prices, and money is taken from the gold on the sheet.
- **The price table** `data/compendium-prices.json` sets prices on items without one: in the world compendiums, in the Items folder, on characters and merchants. Items are matched by name and type; the "(HB)" suffix does not matter. A price set by hand is never changed.

### HB compendiums and tables

- **HB copies.** The module copies Daggerheart's weapon, armor, consumable and loot compendiums into world compendiums, adding "(HB)" to every item. Item IDs are the same as the originals'. A system update does not touch world compendiums, so prices and weights are set right in the HB copies.
- **Roll tables.** The world's tables and the **Rolltables (HB)** copy point to the HB items, not the system ones. A table imported later from a system compendium is switched to HB on the next GM load.
- **Loot tables** in the **Weapons & Armor (HB)** folder:
  - Primary Physical Weapons (HB);
  - Primary Magic Weapons (HB);
  - Secondary Physical Weapons (HB);
  - Secondary Magic Weapons (HB);
  - Armor (HB).

  Each table holds every item of its category, sorted by tier. Rarity is chosen with the roll formula: **Common** = Tier 1, **Uncommon** = Tier 2, **Rare** = Tier 3, **Legendary** = Tier 4. Each formula lands only on items of its tier.

### Weight and carrying load

- **Item weight** is given in slots, fractions allowed. The GM sets it on the **Settings** tab of the item sheet; an empty field means the default weight. The weight shows in the sheet header and as a tag in the inventory: weight × quantity.
- **Default weight.** Weights of particular items come from `data/weights.json`:
  - potions and anything in a vial — 0.5;
  - herbs, powders, seeds and other small things — 0.1;
  - leather, padded and cloth armor — 2;
  - daggers and other small one-handed weapons — 1.

  Everything else goes by type: one-handed weapon 2, two-handed 3, armor 4, other 1.
- **What does not count:** worn armor, and loot with the **Worn** box checked (clothing, cloaks, jewelry).
- **Load bar** on the inventory tab of characters, adversaries and companions: load / capacity, colored by state. Normal is green, light overload yellow, heavy overload red.
- **Character capacity** = base + Strength × slots per point. Below 0, a penalty per point is subtracted instead. With the defaults (10, +4, −2): Strength −1 = 8, 0 = 10, 1 = 14, 2 = 18, 3 = 22 slots. The formula is changed in the settings.
- **Capacity set by hand.** The GM can let a character's capacity be typed in by hand, right in the load bar; an empty field goes back to the formula. A separate box keeps this right to the GM.
- **Adversaries and companions** have no Strength. Their capacity is typed into the bar; empty means the capacity at Strength 0.
- **Capacity bonus.** It comes from an active effect with the key `flags.mist-age-weight.bonusSlots` in **Add** mode, for example a backpack +10. An effect on an item with Transfer checked works while the character has the item. With the **The Mist Age - Equipment** module, the bonus of clothing and a backpack works only while they are worn.
- **No limit.** The weight limit can be turned off for characters: then the load is only counted, with no capacity and no overload.
- **Two overload states.**
  - **Light overload** (a warning): load above capacity, by no more than the light overload limit (8 slots by default).
  - **Heavy overload:** more than that.
- **Overload effect.** An overloaded character gets an effect on the token and among the sheet's effects: "Light overload (+5)" or "Heavy overload (+15)". Each state has its own icon.
- **Penalties.** Each state has an **Edit effect** button in the settings. It opens the regular Daggerheart effect window with the **Changes** and **Conditionals** tabs: the same Attribute Key / Type / Value / Priority rows, the "+" button, the type list with **Add Change** (Armor, Standard Attack and so on), and conditions.
  - **A penalty:** for example `system.evasion`, Add, −1, or `system.traits.agility.value`, Add, −1. A reminder of disadvantage is `system.disadvantageSources`, Add, "Agility rolls (overloaded)": the roll window then shows an icon with the reason.
  - **Saving:** click **Save** in the effect window and close it; a summary of the changes shows next to the button in the settings.
  - **Heavy overload** uses only its own effect, not the light one's changes.
  - **Carried over:** penalties set in versions 1.0.7 and 1.0.8 move into these effects on the GM's load.
- **When to show the effect.** The settings offer: for both states, only for heavy overload, or never. With "never" there are no penalties either. The icons are changed there too; a new image shows at once on effects already applied.

### Used-up consumables

Turned on by the **Remove used-up consumables** setting (on by default).

- **At once.** A consumable whose quantity reaches 0 (a potion drunk, the last arrow spent) disappears from the inventory on the sheet right away.
- **Deletion.** The item itself is deleted on the next GM load of the world. Until then the chat card needs it: Daggerheart takes the action from the item when its button applies the healing, damage or effects of the potion.
- **Item Piles.** Merchants and piles keep empty stacks, as before.

### Inventory of adversaries and companions

- **Inventory tab.** Adversaries and companions get an **Inventory** tab like a character's: money (Penny/Silver/Gold), weapons, armor, consumables and loot, plus the load bar.
- **How to use it:** items are dragged onto the sheet or created with the "+" button. The item's "⋮" menu has **Edit**, **Send to Chat**, **Delete**; with Shift, deleting skips the confirmation.
- **Money** is kept where a character keeps it, so Item Piles can take it.

### Ammunition

- **Weapon setup.** The **Settings** tab of a weapon sheet has an **Ammunition** block:
  - the **Consumes ammunition** box — the weapon spends ammunition;
  - the **Weapon ammunition** field — links to the consumables it shoots. Drag them into the field from a compendium (for example Arrow (HB) from **Consumables (HB)**) or from a character's inventory. Only consumables are accepted.
- **How ammunition is found.**
  - **By link (ID).** A stack in the inventory matches when it was taken from the same compendium entry: bought from a merchant or dragged from the compendium, no matter when. The chain of copies counts too: an HB copy and its system original, or an entry copied from another compendium, are the same item. When an item from an inventory is dropped into the field, the link points to its compendium entry.
  - **By name.** When no stack matches by ID, a stack with the same name as the linked item is used; letter case and the "(HB)" suffix do not matter. The name is saved when an item is dropped into the field, so the search works even after the linked stack is gone.
- **Attack.** The attack roll window of such a weapon shows a **Spend ammunition:** list at the bottom with the linked consumables that still have units, and how many. The roll button takes 1 unit from the chosen consumable.
- **Out of ammunition.** A consumable at quantity 0 disappears from the inventory (see "Used-up consumables"). With no ammunition at all, the window shows "No ammunition left". The roll still goes through, nothing is spent, and a warning appears.
- **A quick roll without the window** spends the first ammunition, in order, of those left.

### Weapon jams

Turned on by the **Weapon jams** setting (on by default). Works for weapons with **Consumes ammunition** checked.

- **Weapon setup.** In the **Ammunition** block, under the box:
  - **Weapon jam die** — the jam die: d4, d6, d8, d10 or d12, d6 by default;
  - **Jam dice** — the number of jam dice, 1 at first.
- **Daggerheart menu → Weapon Jam** (GM only):
  - **Request jam roll** — the GM picks an online player (with their character), and a **Weapon Jam Roll** window opens for that player. The player checks one or more of their weapons with ammunition and clicks **Roll**. Each weapon's jam dice are rolled to chat, for example 2d8.
  - **Raise jam die** — the GM checks characters, and all their weapons with ammunition get +1 jam die.
- **Jammed.** If any of a weapon's jam dice shows a 1, the weapon gets the **Weapon Jammed** effect and a **Clear Weapon Jam** action. The action costs 1 Stress: the character marks Stress, and the effect and the action go away.
- **Rest → Weapon Care.** A character with a weapon with ammunition gets a **Weapon Care** action in the rest window. It takes one rest choice, like the others.
  - **Long rest:** the jam dice of every weapon with ammunition reset to 1.
  - **Short rest:** a window opens where the player picks one weapon and clicks **Care for weapon**; its jam dice reset to 1.

  Weapon Care is added only to the rest window and does not appear in Daggerheart's rest settings (Homebrew).
- **The world must be restarted.** The roll request reaches the player through the module's socket. After installing or updating the module, restart the world: **Return to Setup → Launch World**. F5 is not enough for this.

### Exhaustion checks

Turned on by the **Exhaustion checks** setting (on by default). The button on the character sheet can be removed on its own with the **Exhaustion button on character sheets** setting: then checks happen only at the GM's request.

- **Request.** **Daggerheart menu → Exhaustion → Request exhaustion check** (GM only). The window lists the online players to check (each with their current difficulty) and a **Quiet day** box — a calm day with no events or battles. Each checked player gets their own check, not a group one.
- **From the character sheet.** A check can also be rolled without a request: the button with a tired face in the sheet header, next to the short and long rest buttons. Its tooltip shows the current difficulty. The button is visible to the sheet's owner and the GM, so the GM can roll for a player who is not in the game. For the first check after a long rest, a window asks whether the day was quiet: "Yes" gives advantage.
- **Roll.** The player gets the regular Daggerheart roll window: a **Strength** check against the character's exhaustion difficulty, 15 at first. After a quiet day, the first check since the long rest has advantage. Hope and Fear are gained as on any Daggerheart roll.
- **The outcome** is applied by itself and written to chat:

  | Outcome | Effect | Next difficulty |
  |---|---|---|
  | Critical success | −1 Stress, +1 Hope | +4 |
  | Success with Hope | mark 1 Stress | +2 |
  | Success with Fear | mark 2 Stress | +2 |
  | Failure with Hope | mark 2 Stress; d100 ≤ 50 — lose 1 Hope | +2 |
  | Failure with Fear | mark 3 Stress; d100 ≤ 80 — lose 1 Hope | +4 |

  If no Hope can be lost, 1 Stress is marked instead. If no Stress can be marked, an HP is marked.
- **The difficulty** is kept in the "Exhaustion (next DC N)" effect on the character. A **long rest** in Daggerheart's rest window resets it. The **Reset exhaustion** button in the menu resets the difficulty for all characters, for example when a long rest was taken through "Refresh" in the menu.
- **The world must be restarted** after installing the module (socket), as for weapon jams.

### Long rest reminder

The top of Daggerheart's long rest window shows a reminder, by default "Don't forget to mark off 1 Ration for the long rest.". The text is changed in the **Long rest reminder** setting (Rest section); an empty field means no reminder. A short rest shows none.

### Token names

Foundry writes a token's name only when the token is created and does not update it afterwards. That has two consequences:

- **A renamed actor** kept its old name on the map, in chat and in the combat tracker.
- **A copied adversary.** When an adversary such as Royal Advisor is copied and the copy renamed, its prototype token is still "Royal Advisor". Foundry writes an unlinked token placed with a different name onto its sheet as well. So such a token and its sheet showed "Royal Advisor".

The module keeps one name on the map and on the token's sheet:

- **Linked tokens** and the prototype token carry the actor's name. These are usually player characters.
- **An unlinked token** carries the actor's name. If the token was given a name of its own (say, "Lin Yu" for a Martial Artist token), it keeps it, and its sheet shows the same name.
- **When it syncs:**
  - rename the actor — its prototype and its tokens are renamed;
  - rename a token — its sheet is renamed;
  - rename a token's sheet — the token is renamed.

  When a GM loads the world, linked tokens renamed while no GM was in the game are brought in line too.
- **One-time cleanup.** On the first GM load with this version, the module cleans up old names once. Each actor's prototype gets the actor's name. Each token gets the name from its sheet. The old prototype's names and names from compendiums (Sellsword, Royal Advisor and so on) are taken as leftovers of copying and replaced with the actor's name. Other names given to individual tokens are kept.
- **A name of its own for a prototype or a linked token.** Turn off the **Token names match their sheets** setting.
- **Item Piles.** The module leaves piles and merchants alone.

### Loot from fallen adversaries

When an adversary has all its HP marked or has the **Dead** or **Defeated** status, and it has items or gold, its token becomes an Item Piles pile. Players open it with a double click and take the items and money.

- **The token stays on the map as a body:** with its own image and name; it does not vanish when the pile is emptied.
- **If the adversary gets back up,** the token becomes a regular one again.
- **Empty inventory:** an adversary without items or gold does not become loot.

### Adversary money

Below the money in an adversary's inventory there is a **Roll money** button (only the GM sees it). It rolls how much money the adversary has and adds it straight to its Penny/Silver/Gold.

- **Level of wealth.** First the GM picks how wealthy the adversary is: the rows are the Daggerheart formulas of the money table (Destitute, Poor, Common…), each with its amount and who it fits. The module remembers the last choice until a reload, so a group of identical bandits can be clicked through in a row.
- **Amount.** The table is rolled with the chosen formula, and the rolls in the text of the result are rolled as an amount. The currency is taken after `#`: `[[/r 2d6 # Silver]]`, `[[/r 1d4 # Silver]] + [[/r 1d10 # Penny]]`. The world's currency names (Penny, Silver, Gold) work, and so do Daggerheart's usual names (coins, handfuls, bags, chests).
- **Chat.** The rolls and the total ("Added: 3 Silver, 7 Penny") are whispered to the GM.
- **The table** is **Money from Enemies (HB)** by default; its name is changed in the settings. The module does not include the table itself: any table of this kind will do.
- **Rolling again** adds the money once more; anything extra is fixed by hand in the money fields.
- **An adversary already down** with no items becomes Item Piles loot after its money is rolled.

## Settings

**Game Settings → Configure Settings → The Mist Age - Toolkit → Open settings** (GM only). The window is split into sections:

| Section | Setting | Default |
|---|---|---|
| **Currency** | Rate: coins per handful | 10 |
| | Rate: handfuls per bag | 100 |
| | Rate: bags per chest | 10 |
| **Carrying capacity** | Base capacity | 10 |
| | Slots per point of Strength | 4 |
| | Slots lost per negative point | 2 |
| | Carrying limit for characters | on |
| | Players set character capacity by hand | off |
| | Only the GM sets character capacity | off |
| **Overload** | Light overload limit (slots of light overload) | 8 |
| | Overload effect on characters: Off / Light and heavy overload / Only heavy overload | Light and heavy overload |
| | Light overload icon (an image, file picker with a preview) | `icons/svg/anchor.svg` |
| | Heavy overload icon | `icons/svg/downgrade.svg` |
| | Light overload effect (Edit effect button — the Daggerheart effect window) | no changes |
| | Heavy overload effect | no changes |
| **Inventory** | Remove used-up consumables | on |
| **Weapons** | Weapon jams | on |
| **Exhaustion** | Exhaustion checks | on |
| | Exhaustion button on character sheets | on |
| **Rest** | Long rest reminder (text; empty turns it off) | Don't forget to mark off 1 Ration for the long rest. |
| **Tokens** | Token names match their sheets | on |
| **Adversaries** | Loot from fallen adversaries | on |
| | Money button for adversaries | on |
| | Money table (the table's name) | Money from Enemies (HB) |

## Data files

- **`data/compendium-prices.json`** — the price table: item name and type, price in handfuls, and the source line from the price list. A changed table is applied on the next GM load, but only to items without a price.
- **`data/weights.json`** — default weights of particular items. Changes show after a reload. A weight typed in by hand takes precedence.

## For developers

- **API:** `game.modules.get("mist-age-toolkit").api`, with `getCapacity(strength)`, `getItemWeight(item)`, `getItemLoad(item)`, `getEncumbrance(actor)`. The last one returns the capacity, load, overload and state (`ok`, `overloaded`, `heavy`).
- **Where data is kept:**
  - price — `flags.mist-age-prices.price`;
  - weight — `flags.mist-age-weight.slots`;
  - worn — `flags.mist-age-weight.worn`;
  - capacity set by hand — `flags.mist-age-weight.capacity`;
  - weapon ammunition — `flags.mist-age-toolkit.consumesAmmo` and `flags.mist-age-toolkit.ammoItems` (UUIDs of the linked consumables);
  - weapon jams — `flags.mist-age-toolkit.jamDie` and `flags.mist-age-toolkit.jamCount`; the jam effect is marked with `flags.mist-age-toolkit.jammed`, and the Clear Weapon Jam action has the id `mistAgeClearJam0`.

  These are the namespaces of the earlier separate modules. They are kept so old data works without being moved.
- **Gold of adversaries and companions** is kept in `system.gold`. If the module is turned off, Foundry drops this field the next time such an actor is saved.
- **Old modules.** This module replaces the earlier **The Mist Age - Item Prices** and **The Mist Age - Item Weight** and carries over their settings. If the old modules are still enabled, the toolkit does not start and shows an error: turn them off.

## Releasing a new version

1. Commit and push the changes.
2. Create and push a tag, for example `git tag v1.0.1`, then `git push origin v1.0.1`. A GitHub release with that tag works too.
3. The **Release** GitHub Action creates the release, sets the version in `module.json` and attaches `module.json` and `module.zip`. Foundry offers the update to everyone who installed the module from the link.
