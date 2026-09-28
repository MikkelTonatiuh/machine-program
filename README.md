# Machine Program

A guided workout player for a 7-day, machines-only training program. The screen is the workout: a 3D figure performs
each exercise on its machine with the working muscles lit, and you follow the day from the warm-up to the last set.

Open it: https://mikkeltonatiuh.github.io/machine-program/

- Every screen has one button at the bottom: Start, Done, Skip rest, Next.
- On a set, set the reps with − and + (or drag up or down on the figure), then press Done. Undo takes it back.
- Rest runs by itself (the glow along the horizon is the timer); Skip rest ends it early.
- Drag sideways on the figure to turn it. Tap the day at the top left to choose another day.

## Install it on your phone

**Android (Chrome):** open the link, tap the menu (three dots), then **Add to home screen** and **Install**. It opens
full screen from its icon.

**iPhone (Safari):** open the link in Safari, tap **Share**, then **Add to Home Screen**.

After the first visit it also works without a connection.

## Your progress stays on your phone

Your sets, the day you are on and your reps from last time are saved in the browser's storage on that phone only.
There is no account and nothing is uploaded, so each phone keeps its own progress. Clearing the site's data in the
browser starts it fresh.

## Credits

Based on Jeff Nippard's public training advice. Not affiliated.

The 3D engine uses [three.js](https://threejs.org) (MIT license), loaded from cdn.jsdelivr.net, and the Newsreader and
Instrument Sans typefaces come from Google Fonts. Both are loaded from their CDNs on the first visit and then kept on
the phone for offline use.

## Updates

A new version downloads in the background and is used the next time the app is opened.
