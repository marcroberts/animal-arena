# Pick two. Survive the hour.

A browser simulation of the thought experiment:

> You're in an arena with 50 hawks, 10 crocodiles, 3 brown bears, 15 wolves, 1 hunter with a rifle,
> 7 buffalo, 10,000 rats, 5 gorillas and 4 lions. Pick 2 to defend you. The others attack you.
> Goal is to survive 1 hour.

## Running it

Open `index.html` in a browser. There is no build step and no server code; it also works from any static host.

- **Watch the hour**: a full-screen, top-down replay of one run. *Auto* speed slows down for the action
  and speeds through lulls; 1×–200× are fixed. Scroll to zoom, drag to pan, hover any animal to see what it's doing.
  Keys: space pauses, `1`–`6` set the speed, `F` toggles full screen, `Esc` goes back.
- **Run 100 trials**: 100 independent hours for your pair. Shows survival rate with a 95% interval,
  what killed you, when you died and damage by source. Click any run to watch that exact run.
- **Rank all 36 pairs**: every possible pair, ranked by survival rate.
- **Tune**: edit every species' stats. *Grounded* (default) and *Arcade* presets are included.

Trials run in Web Workers (built from a Blob of the engine, so they work on `file://`) and fall back to
the main thread if workers are blocked.

## How the model works

Everything is in `js/engine.js` (pure logic, no DOM). Fixed 0.2 s steps with a seeded RNG, so any
`(settings, pair, seed)` replays identically. Watching a run from the trials list shows exactly the run that was counted.

- **Attackers** circle at a distance and decide each second whether to commit. That chance is their
  *aggression*, reduced by *fear*: the intimidation of your healthy defenders nearby divided by their *courage*.
  Interest halves every *persistence* minutes.
- **Defenders** keep a guard ring around you. They only engage things that are charging you, get too close,
  or are mauling another guard. Big guards body-block charges (more likely the bigger they are) and act as cover
  from the rifle; you keep a big body between yourself and an armed hunter. The two fastest defenders run
  down an enemy hunter.
- **Rats** are simulated in clusters of 50. Each target has limited room for biters, armour blunts bites,
  and rats hug the walls when they aren't committed. Rats also mob carcasses.
- **Hawks** soar, dive, strike and climb. They can only be hit while low. Defending hawks hunt rats
  (and stop to eat them) and harass the hunter.
- **Crocodiles** are fast and harder to hurt in the pond, slow and quick to tire on land, and their bite pins.
- **The hunter** needs a still aim and a clear line of fire, has a 5-round magazine and limited ammo,
  and bullets hit whatever is in the way.
- **Grounded behaviour**: animals flee when badly hurt (once, then fight on), predators stop to eat kills,
  and wolves get a pack bonus.

The numbers are judgement calls, not zoology. Change them under *Tune* and re-rank.

## Files

| Path | What |
|---|---|
| `index.html` | Page shell |
| `css/style.css` | Styles |
| `js/engine.js` | Simulation engine and species defaults |
| `js/trials.js` | Worker pool for Monte Carlo runs |
| `js/render.js` | Canvas renderer |
| `js/app.js` | UI: picking, results, tuning, live view |
