# Machine Program

A guided workout player for a 7-day, machines-only training program. The screen is the workout: a 3D figure performs
each exercise on its machine with the working muscles lit, and you follow the day from the warm-up to the last set.

The program is custom. It is not one of Jeff Nippard's programs (his published ones run 2 to 6 days a week); his free videos and
the research they cite are where the exercise choices, effort, tempo and rest come from. The exact list, in order, is in
[PROGRAM.md](PROGRAM.md).

Open it, and download it to your phone (the **Download app** button is on its first screen): https://mikkeltonatiuh.github.io/machine-program/

- The app opens on the seven days as squares, under the week you are in ("Week 3 · 2 of 7 days done"). Each square shows its
  exercise moving; the days you finished this week are ticked with the time they took; the one you are in the middle of says
  Resume. Tap a square to open that day.
- Every screen has one button at the bottom: Start, Done, Skip rest, Next. The round button beside it is Undo.
- On a set, choose the reps and the weight in kg with − and + (hold the weight button to go faster; tap the weight to type an
  exact number, like 12.5), then press Done. The weight starts on what you lifted last time. You can also drag up or down on
  the figure to change the reps.
- Progression is double progression: when you reached the top of the rep range on every set of an exercise, the next time
  starts one step heavier and back at the bottom of the range (the card and the message after the last set say the weight); when
  you did not, it starts on the same weight and the reps you did.
- The text that tells you how to do the rep is a card right above the figure: the phase the figure is in (Press fast,
  Return slow 2–3 s), the set's rule (how close to failure, add weight) and one short cue. It never
  covers the figure. Turn the figure and it steps aside. On the bike it gives the pulse to hold instead.
- Rest runs by itself (the glow along the horizon is the timer); Skip rest ends it early.
- The clock at the top right times the workout, from your first action to the last set. The finished day shows its time.
- Made a mistake? Undo takes back the last step, and again for the one before. The three dots at the top right hold
  Restart workout (it starts the day over, and Undo brings it back) and All workouts.
- Drag sideways on the figure to turn it. Tap the day at the top left for the overview.

## Download it to your phone

Press **Download app** on the overview. On Android (Chrome, Edge, Samsung Internet) that installs it; on an iPhone or iPad
it shows the two taps (Share, then **Add to Home Screen**) because Safari lets no page start that itself. The button is not
shown in the installed app, nor once the app is installed. If your browser has no button, its own menu has **Install app**
or **Add to Home screen**.

After the first visit it also works without a connection.

## Your progress stays on your phone

Your sets and weights, the day you are on, the time each workout took and your reps from last time are saved in the
browser's storage on that phone only. There is no account and nothing is uploaded, so each phone keeps its own progress.
Clearing the site's data in the browser starts it fresh. A finished week stays ticked until you begin the next workout (or
press Start a new week at the bottom of the overview); that is also when the week number goes up.

## Where the numbers come from

The app says little: each line is there because it changes what you do. Where the lines come from, and how sure they are:

- **Warm-up.** 5 to 10 minutes of easy cycling until you break a light sweat, at about 55–65% of maximum heart rate: 105–125 bpm
  at age 28 (Jeff Nippard's warm-up video, 2019; Tanaka 2001 for the maximum). The app gives no warm-up weights: what is light
  is different for everyone, and Jeff's exact warm-up-set percentages are in his paid programs only.
- **Recovery-day cardio.** 20 to 40 minutes, easy, 115–140 bpm at 28. If you cannot speak in full sentences, slow down whatever the
  number says (the talk test: Reed and Pipe 2014). 60–70% of maximum heart rate is really zone 1, so the app does not call it
  zone 2 (Sitko 2025). Jeff gives no pulse for it; the range comes from the research.
- **Effort.** Most sets stop 1–2 reps short of failure and the last set goes to failure (Jeff, 2024–25; his only exceptions are
  free-weight squats and deadlifts). Hack squat and leg press stop 0–1 reps short instead, which grows the same
  ([Refalo 2024](https://pubmed.ncbi.nlm.nih.gov/38393985/)). Set the Smith machine's safety stops before a set to failure.
- **Tempo.** Lift in about 1 s, lower in 2–3 s, 2–8 s per rep in all, with the muscle stretched at the bottom
  ([the 2024 review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10801605/) Jeff co-wrote). Tempo matters little (Enes 2025), so
  control the lowering and lift with intent. A timed pause has no evidence behind it, except on the calf raise, where Jeff pauses 1–2 s.
- **Rest.** By exercise type: 3 minutes after heavy machine compounds, 2 after other compounds, 90 seconds after isolation work.
  Past about 90 s there is no clear extra growth ([Singer 2024](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full)).
- **Progression.** Double progression, as above. Reps or weight both count as progressive overload.
- **Cues.** One short line from Jeff's tier-list and technique videos. Where he has no public cue (pec deck, hip thrust) the app
  shows none. The hip adduction line ("Open slowly against the weight") is not Jeff's: it comes from the program file this app
  was built from, which says "slow eccentric" for that exercise.

Jeff's videos were read from transcripts, mostly on mirror sites rather than YouTube itself, so check anything you plan to rely on
against the source.

## Credits

A custom program, built on ideas from Jeff Nippard's free videos and published research. The 7-day routine is not his. Not
affiliated.

The 3D engine uses [three.js](https://threejs.org) (MIT license), loaded from cdn.jsdelivr.net, and the Newsreader and
Instrument Sans typefaces come from Google Fonts. Both are loaded from their CDNs on the first visit and then kept on
the phone for offline use.

## Updates

A new version downloads in the background and is used the next time the app is opened.

## For the maintainer

Three small tools keep the files in step (Node 18+; the first needs `playwright` and its Chromium):

- `node tools/covers.mjs` draws the overview's pictures (`covers/`) from the app's own figure engine: an animation and a
  still frame for each day's cover exercise (`cover` in the program inside `index.html`). Run it when an exercise's
  animation or the cover choice changes. `--only 1,3` redraws just those days.
- `node tools/pwa.mjs` writes the service worker's file list and hashes (the first line of `sw.js`). The worker refuses a
  file that does not match, so run it after changing **any** file the app ships, before committing.
  `node tools/pwa.mjs --check` fails when the list is out of date.
- `node tools/program.mjs` writes [PROGRAM.md](PROGRAM.md), the exact list of days, exercises and their order, from the program
  inside `index.html`. Run it after **any** change to the program, so the change shows up as a change to that list.
  `node tools/program.mjs --check` fails when the list is stale, when a step names an exercise that has no entry or animation
  file, or when an entry is not used by any step.
